//! Version web locale : l'app sert son interface sur 127.0.0.1, ouverte dans un onglet du navigateur.
//! Le navigateur n'a pas l'IPC de Tauri : `/invoke/<cmd>` (liste fermée de commandes), `/fetch`
//! (requête faite ici, mêmes hôtes que le plugin HTTP) et `/kv` (copie des réglages partagés).

use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, TcpListener};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use keyring::Error;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;
use tauri_plugin_opener::OpenerExt;

pub const DEFAULT_PORT: u16 = 14200;
/// En dessous : ports réservés au système.
const MIN_PORT: u16 = 1024;
const CONFIG_FILE: &str = "web.json";
/// Entrée du trousseau du secret du lien (aucun compte GitHub ou Slack ne porte ce nom).
const SECRET_ACCOUNT: &str = "web-secret";
const COOKIE: &str = "pr_radar_web";
/// Erreur traduite par l'interface.
const PORT_BUSY: &str = "port-busy";
/// CSP de tauri.conf.json, `connect-src` ramené à la même origine (plus d'IPC : tout passe par ce serveur).
const CSP: &str = "default-src 'self'; connect-src 'self'; img-src 'self' https://avatars.githubusercontent.com; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/// Méthodes Slack de la capacité `http:default` (src-tauri/capabilities/default.json).
const SLACK_METHODS: [&str; 5] = [
    "oauth.v2.access",
    "auth.revoke",
    "search.messages",
    "conversations.list",
    "users.info",
];
const MAX_REDIRECTS: usize = 10;
/// GitHub refuse une requête sans User-Agent (403) ; même valeur que tauri-plugin-http (`<crate>/<version>`).
const USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));

/* ---------- Réglage lu au lancement : activé, port ---------- */

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy)]
#[serde(default)]
struct Config {
    enabled: bool,
    port: u16,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
        }
    }
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(CONFIG_FILE))
}

fn load_config(app: &AppHandle) -> Config {
    config_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, c: Config) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_vec(&c).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/* ---------- État ---------- */

struct Server {
    port: u16,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
struct Kv {
    /// faux tant que la fenêtre de l'app n'a pas envoyé son instantané (lancement)
    seeded: bool,
    map: HashMap<String, String>,
}

#[derive(Default)]
pub struct Web {
    server: Mutex<Option<Server>>,
    /// incrémenté à chaque arrêt : une connexion restée ouverte vers l'ancien serveur est refusée
    generation: AtomicU64,
    error: Mutex<Option<String>>,
    secret: Mutex<Option<String>>,
    /// hôtes GitHub Enterprise autorisés par `allow_host`
    hosts: Arc<Mutex<HashSet<String>>>,
    kv: Mutex<Kv>,
    client: OnceLock<reqwest::Client>,
}

fn state(app: &AppHandle) -> &Web {
    app.state::<Web>().inner()
}

/// Ajoute un hôte GitHub Enterprise à ceux que `/fetch` peut joindre ; faux s'il y était déjà.
pub fn allow(app: &AppHandle, host: &str) -> bool {
    state(app).hosts.lock().unwrap().insert(host.to_string())
}

pub fn running(app: &AppHandle) -> bool {
    state(app).server.lock().unwrap().is_some()
}

/* ---------- Secret du lien ---------- */

fn new_secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Secret enregistré au trousseau, créé au premier usage puis gardé.
fn secret(app: &AppHandle) -> Result<String, String> {
    let mut cached = state(app).secret.lock().unwrap();
    if let Some(s) = cached.as_ref() {
        return Ok(s.clone());
    }
    let entry = crate::entry(SECRET_ACCOUNT)?;
    let s = match entry.get_password() {
        Ok(s) => s,
        Err(Error::NoEntry) => {
            let s = new_secret()?;
            entry.set_password(&s).map_err(|e| e.to_string())?;
            s
        }
        Err(e) => return Err(e.to_string()),
    };
    *cached = Some(s.clone());
    Ok(s)
}

/// Comparaison en temps constant (longueurs publiques).
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/* ---------- Contrôles des requêtes ---------- */

/// En-tête Host attendu (anti DNS rebinding) : 127.0.0.1 ou localhost, sur le port du serveur.
fn host_ok(host: Option<&str>, port: u16) -> bool {
    host.is_some_and(|h| h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"))
}

/// Origin (envoyé par le navigateur sur les POST) : absent ou la page elle-même.
fn origin_ok(origin: Option<&str>, host: &str) -> bool {
    origin.is_none_or(|o| o == format!("http://{host}"))
}

/// Cookie de session égal au secret actuel.
fn cookie_ok<'a>(cookies: impl Iterator<Item = &'a str>, secret: &str) -> bool {
    cookies
        .flat_map(|c| c.split(';'))
        .filter_map(|p| p.trim().split_once('='))
        .any(|(k, v)| k == COOKIE && same(v.as_bytes(), secret.as_bytes()))
}

/// Commandes ouvertes au navigateur, et comptes du trousseau qu'elles peuvent toucher.
fn command_allowed(cmd: &str, account: Option<&str>) -> bool {
    match cmd {
        "gh_token" | "allow_host" => true,
        "get_token" => account.is_some_and(|a| a != SECRET_ACCOUNT),
        // seul cas d'écriture : jetons Slack renouvelés par le navigateur
        "set_token" => account.is_some_and(|a| a.starts_with("slack:")),
        _ => false,
    }
}

/// Même périmètre que la capacité `http:default` + hôtes ajoutés par `allow_host`.
fn fetch_allowed(url: &str, hosts: &HashSet<String>) -> bool {
    let Ok(u) = tauri::Url::parse(url) else {
        return false;
    };
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    let Some(host) = u.host_str() else {
        return false;
    };
    let authority = match u.port() {
        Some(p) => format!("{host}:{p}"),
        None => host.to_string(),
    };
    let path = u.path();
    match authority.as_str() {
        "api.github.com" => true,
        "github.com" => path.starts_with("/login/"),
        "slack.com" => {
            u.query().is_none() && SLACK_METHODS.iter().any(|m| path == format!("/api/{m}"))
        }
        a => hosts.contains(a) && path.starts_with("/api/"),
    }
}

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    port: u16,
    generation: u64,
}

fn status(code: StatusCode) -> Response {
    (code, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

/// Host (toutes les routes), puis cookie (routes de l'API).
#[allow(clippy::result_large_err)]
fn guard(ctx: &Ctx, headers: &HeaderMap, api: bool) -> Result<(), Response> {
    let web = state(&ctx.app);
    if web.generation.load(Ordering::SeqCst) != ctx.generation {
        // serveur arrêté : la connexion encore ouverte est fermée
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONNECTION, "close")],
        )
            .into_response());
    }
    let text = |h| headers.get(h).and_then(|v: &HeaderValue| v.to_str().ok());
    let host = text(header::HOST);
    if !host_ok(host, ctx.port) || !origin_ok(text(header::ORIGIN), host.unwrap_or_default()) {
        return Err(status(StatusCode::FORBIDDEN));
    }
    if api {
        let secret = web.secret.lock().unwrap().clone().unwrap_or_default();
        let cookies = headers
            .get_all(header::COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok());
        if secret.is_empty() || !cookie_ok(cookies, &secret) {
            return Err(status(StatusCode::UNAUTHORIZED));
        }
    }
    Ok(())
}

fn json_response(code: StatusCode, v: &Value) -> Response {
    (
        code,
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        v.to_string(),
    )
        .into_response()
}

/* ---------- Routes ---------- */

/// Interface : fichiers embarqués dans l'app (même résolution que la fenêtre).
async fn asset(State(ctx): State<Ctx>, method: Method, uri: Uri, headers: HeaderMap) -> Response {
    if let Err(r) = guard(&ctx, &headers, false) {
        return r;
    }
    if method != Method::GET && method != Method::HEAD {
        return status(StatusCode::METHOD_NOT_ALLOWED);
    }
    match ctx.app.asset_resolver().get(uri.path().to_string()) {
        Some(a) => (
            [
                (header::CONTENT_TYPE, a.mime_type),
                (header::CONTENT_SECURITY_POLICY, CSP.into()),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
                (header::REFERRER_POLICY, "no-referrer".into()),
            ],
            a.bytes,
        )
            .into_response(),
        None => status(StatusCode::NOT_FOUND),
    }
}

/// Échange le secret du lien (`#k=…`) contre le cookie de session.
async fn auth(State(ctx): State<Ctx>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = guard(&ctx, &headers, false) {
        return r;
    }
    let given = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|v| v.get("secret")?.as_str().map(str::to_owned))
        .unwrap_or_default();
    let Ok(secret) = secret(&ctx.app) else {
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    };
    if !same(given.as_bytes(), secret.as_bytes()) {
        return status(StatusCode::UNAUTHORIZED);
    }
    (
        StatusCode::NO_CONTENT,
        [
            (
                header::SET_COOKIE,
                format!("{COOKIE}={secret}; HttpOnly; SameSite=Strict; Path=/"),
            ),
            (header::CACHE_CONTROL, "no-store".into()),
        ],
    )
        .into_response()
}

fn dispatch(app: &AppHandle, cmd: &str, args: &Value) -> Result<Value, String> {
    let arg = |k: &str| {
        args.get(k)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| format!("missing argument: {k}"))
    };
    let account = args.get("account").and_then(Value::as_str);
    if !command_allowed(cmd, account) {
        return Err(format!("command not allowed: {cmd}"));
    }
    match cmd {
        "get_token" => crate::get_token(arg("account")?).map(|t| json!(t)),
        "set_token" => crate::set_token(arg("account")?, arg("token")?).map(|()| Value::Null),
        "gh_token" => Ok(json!(crate::gh_token())),
        "allow_host" => crate::allow_host(app.clone(), arg("host")?).map(|()| Value::Null),
        _ => Err(format!("command not allowed: {cmd}")),
    }
}

/// Commande Tauri, pour le navigateur : seulement celles de `command_allowed`.
async fn invoke(
    State(ctx): State<Ctx>,
    Path(cmd): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(r) = guard(&ctx, &headers, true) {
        return r;
    }
    let args = if body.is_empty() {
        json!({})
    } else {
        match serde_json::from_slice::<Value>(&body) {
            Ok(v) => v,
            Err(_) => return status(StatusCode::BAD_REQUEST),
        }
    };
    let app = ctx.app.clone();
    // trousseau et `gh` : appels bloquants
    match tauri::async_runtime::spawn_blocking(move || dispatch(&app, &cmd, &args)).await {
        Ok(Ok(v)) => json_response(StatusCode::OK, &v),
        Ok(Err(e)) => json_response(StatusCode::BAD_REQUEST, &json!(e)),
        Err(_) => status(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

#[derive(serde::Deserialize)]
struct FetchRequest {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    body: Option<String>,
}

/// En-têtes transmis : sans ceux du navigateur ou de la connexion, avec un User-Agent par défaut.
fn forwarded_headers(given: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = given
        .into_iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v))
        .filter(|(k, _)| {
            !matches!(
                k.as_str(),
                "host" | "cookie" | "origin" | "referer" | "content-length" | "connection"
            )
        })
        .collect();
    if !out.iter().any(|(k, _)| k == "user-agent") {
        out.push(("user-agent".into(), USER_AGENT.into()));
    }
    out
}

fn client(app: &AppHandle) -> &reqwest::Client {
    let web = state(app);
    web.client.get_or_init(|| {
        let hosts = web.hosts.clone();
        reqwest::Client::builder()
            // redirection : seulement vers une adresse autorisée elle aussi
            .redirect(reqwest::redirect::Policy::custom(move |a| {
                if a.previous().len() >= MAX_REDIRECTS {
                    a.error("too many redirects")
                } else if fetch_allowed(a.url().as_str(), &hosts.lock().unwrap()) {
                    a.follow()
                } else {
                    a.stop()
                }
            }))
            .build()
            .unwrap_or_default()
    })
}

/// Requête HTTP faite par l'app pour le navigateur (pas de CORS côté GitHub et Slack).
async fn fetch(State(ctx): State<Ctx>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = guard(&ctx, &headers, true) {
        return r;
    }
    let Ok(req) = serde_json::from_slice::<FetchRequest>(&body) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let hosts = state(&ctx.app).hosts.lock().unwrap().clone();
    if !fetch_allowed(&req.url, &hosts) {
        return json_response(
            StatusCode::FORBIDDEN,
            &json!(format!("url not allowed: {}", req.url)),
        );
    }
    let Ok(method) = reqwest::Method::from_bytes(req.method.as_deref().unwrap_or("GET").as_bytes())
    else {
        return status(StatusCode::BAD_REQUEST);
    };
    let mut out = client(&ctx.app).request(method, &req.url);
    for (k, v) in forwarded_headers(req.headers) {
        out = out.header(k, v);
    }
    if let Some(b) = req.body {
        out = out.body(b);
    }
    let res = match out.send().await {
        Ok(r) => r,
        Err(e) => return json_response(StatusCode::BAD_GATEWAY, &json!(e.to_string())),
    };
    let code = res.status().as_u16();
    let headers: Vec<(String, String)> = res
        .headers()
        .iter()
        .filter_map(|(k, v)| Some((k.to_string(), v.to_str().ok()?.to_string())))
        .collect();
    let text = res.text().await.unwrap_or_default();
    json_response(
        StatusCode::OK,
        &json!({ "status": code, "headers": headers, "body": text }),
    )
}

/// Copie des réglages partagés : lecture.
async fn kv_get(State(ctx): State<Ctx>, headers: HeaderMap) -> Response {
    if let Err(r) = guard(&ctx, &headers, true) {
        return r;
    }
    let kv = state(&ctx.app).kv.lock().unwrap();
    if !kv.seeded {
        return status(StatusCode::SERVICE_UNAVAILABLE);
    }
    json_response(StatusCode::OK, &json!(kv.map))
}

/// Copie des réglages partagés : écritures du navigateur (`null` : clé effacée).
async fn kv_post(State(ctx): State<Ctx>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = guard(&ctx, &headers, true) {
        return r;
    }
    let Ok(entries) = serde_json::from_slice::<HashMap<String, Option<String>>>(&body) else {
        return status(StatusCode::BAD_REQUEST);
    };
    if !state(&ctx.app).kv.lock().unwrap().seeded {
        return status(StatusCode::SERVICE_UNAVAILABLE);
    }
    kv_apply(&ctx.app, entries);
    status(StatusCode::NO_CONTENT)
}

fn kv_apply(app: &AppHandle, entries: HashMap<String, Option<String>>) {
    let mut kv = state(app).kv.lock().unwrap();
    for (k, v) in entries {
        match v {
            Some(v) => kv.map.insert(k, v),
            None => kv.map.remove(&k),
        };
    }
}

/* ---------- Démarrage, arrêt ---------- */

fn start(app: &AppHandle, port: u16) -> Result<(), String> {
    secret(app)?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            PORT_BUSY.to_string()
        } else {
            e.to_string()
        }
    })?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let web = state(app);
    let ctx = Ctx {
        app: app.clone(),
        port,
        generation: web.generation.load(Ordering::SeqCst),
    };
    let router = Router::new()
        .route("/auth", post(auth))
        .route("/invoke/{cmd}", post(invoke))
        .route("/fetch", post(fetch))
        .route("/kv", axum::routing::get(kv_get).post(kv_post))
        .fallback(asset)
        .with_state(ctx);
    let task = tauri::async_runtime::spawn(async move {
        if let Ok(l) = tokio::net::TcpListener::from_std(listener) {
            let _ = axum::serve(l, router).await;
        }
    });
    *web.server.lock().unwrap() = Some(Server { port, task });
    Ok(())
}

/// Arrête le serveur ; renvoie sa tâche, à attendre pour que le port soit libéré.
fn stop(app: &AppHandle) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let web = state(app);
    web.generation.fetch_add(1, Ordering::SeqCst);
    let server = web.server.lock().unwrap().take()?;
    server.task.abort();
    Some(server.task)
}

fn set_error(app: &AppHandle, e: Option<String>) {
    *state(app).error.lock().unwrap() = e;
}

/// Lancement de l'app : démarre le serveur si la version web est activée.
pub fn autostart(app: &AppHandle) {
    let c = load_config(app);
    if c.enabled
        && let Err(e) = start(app, c.port)
    {
        set_error(app, Some(e));
    }
}

/// Fermeture de l'app.
pub fn shutdown(app: &AppHandle) {
    let _ = stop(app);
}

/// Ouvre l'interface dans le navigateur du système, avec le secret dans le fragment (jamais envoyé au serveur).
pub fn open(app: &AppHandle) -> Result<(), String> {
    let port = state(app)
        .server
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.port)
        .ok_or("web server not running")?;
    let secret = secret(app)?;
    app.opener()
        .open_url(format!("http://127.0.0.1:{port}/#k={secret}"), None::<&str>)
        .map_err(|e| e.to_string())
}

/* ---------- Commandes (fenêtre de l'app) ---------- */

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    port: u16,
    running: bool,
    /// `port-busy`, ou message du système
    error: Option<String>,
}

#[tauri::command]
pub fn web_status(app: AppHandle) -> Result<Status, String> {
    let c = load_config(&app);
    Ok(Status {
        enabled: c.enabled,
        port: c.port,
        running: running(&app),
        error: state(&app).error.lock().unwrap().clone(),
    })
}

/// Active / désactive la version web, change son port ; une erreur de démarrage est dans le statut.
#[tauri::command]
pub async fn web_configure(app: AppHandle, enabled: bool, port: u16) -> Result<Status, String> {
    if port < MIN_PORT {
        return Err(format!("invalid port: {port}"));
    }
    save_config(&app, Config { enabled, port })?;
    if let Some(task) = stop(&app) {
        let _ = task.await;
    }
    set_error(&app, None);
    if enabled && let Err(e) = start(&app, port) {
        set_error(&app, Some(e));
    }
    crate::refresh_tray(&app);
    web_status(app)
}

/// Nouveau secret : tous les navigateurs connectés perdent l'accès.
#[tauri::command]
pub fn web_rotate_secret(app: AppHandle) -> Result<(), String> {
    let s = new_secret()?;
    crate::entry(SECRET_ACCOUNT)?
        .set_password(&s)
        .map_err(|e| e.to_string())?;
    *state(&app).secret.lock().unwrap() = Some(s);
    Ok(())
}

#[tauri::command]
pub fn web_open(app: AppHandle) -> Result<(), String> {
    open(&app)
}

/// Lancement de la fenêtre : son localStorage devient la copie partagée.
#[tauri::command]
pub fn kv_seed(app: AppHandle, entries: HashMap<String, String>) -> Result<(), String> {
    let mut kv = state(&app).kv.lock().unwrap();
    kv.map = entries;
    kv.seeded = true;
    Ok(())
}

#[tauri::command]
pub fn kv_push(app: AppHandle, entries: HashMap<String, Option<String>>) -> Result<(), String> {
    kv_apply(&app, entries);
    Ok(())
}

#[tauri::command]
pub fn kv_pull(app: AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(state(&app).kv.lock().unwrap().map.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_check() {
        assert!(host_ok(Some("127.0.0.1:14200"), 14200));
        assert!(host_ok(Some("localhost:14200"), 14200));
        for bad in [
            None,
            Some("127.0.0.1"),
            Some("127.0.0.1:14201"),
            Some("evil.com:14200"),
            Some("127.0.0.1.evil.com:14200"),
            Some("[::1]:14200"),
        ] {
            assert!(!host_ok(bad, 14200), "{bad:?}");
        }
    }

    #[test]
    fn origin_check() {
        assert!(origin_ok(None, "127.0.0.1:14200"));
        assert!(origin_ok(Some("http://127.0.0.1:14200"), "127.0.0.1:14200"));
        assert!(!origin_ok(Some("http://evil.com"), "127.0.0.1:14200"));
        assert!(!origin_ok(Some("null"), "127.0.0.1:14200"));
    }

    #[test]
    fn cookie_check() {
        let ok = |c: &[&str]| cookie_ok(c.iter().copied(), "s3cret");
        assert!(ok(&["pr_radar_web=s3cret"]));
        assert!(ok(&["a=1; pr_radar_web=s3cret; b=2"]));
        assert!(ok(&["a=1", "pr_radar_web=s3cret"]));
        assert!(!ok(&[]));
        assert!(!ok(&["pr_radar_web=other"]));
        assert!(!ok(&["pr_radar_web=s3cre"]));
        assert!(!ok(&["pr_radar_web="]));
        assert!(!ok(&["x_pr_radar_web=s3cret"]));
    }

    #[test]
    fn default_user_agent() {
        let h = |v: &[(&str, &str)]| {
            forwarded_headers(
                v.iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            )
        };
        assert!(
            h(&[("Authorization", "Bearer t")]).contains(&("user-agent".into(), USER_AGENT.into()))
        );
        assert_eq!(
            h(&[("User-Agent", "custom")]),
            vec![("user-agent".to_string(), "custom".to_string())]
        );
        assert_eq!(
            h(&[("Cookie", "a=1"), ("Host", "x"), ("Origin", "o")]),
            vec![("user-agent".to_string(), USER_AGENT.to_string())]
        );
    }

    #[test]
    fn secrets_differ_and_are_hex() {
        let (a, b) = (new_secret().unwrap(), new_secret().unwrap());
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn command_allowlist() {
        assert!(command_allowed("gh_token", None));
        assert!(command_allowed("allow_host", None));
        assert!(command_allowed("get_token", Some("github")));
        assert!(command_allowed("get_token", Some("slack:T1")));
        assert!(!command_allowed("get_token", Some(SECRET_ACCOUNT)));
        assert!(!command_allowed("get_token", None));
        assert!(command_allowed("set_token", Some("slack:T1")));
        assert!(!command_allowed("set_token", Some("github")));
        assert!(!command_allowed("set_token", Some(SECRET_ACCOUNT)));
        for cmd in [
            "delete_token",
            "uninstall_run",
            "uninstall_plan",
            "set_tray",
            "web_configure",
            "web_rotate_secret",
            "kv_seed",
            "plugin:notification|notify",
        ] {
            assert!(!command_allowed(cmd, Some("slack:T1")), "{cmd}");
        }
    }

    #[test]
    fn fetch_allowlist() {
        let hosts: HashSet<String> =
            ["ghe.example.com".into(), "ghe2.example.com:8443".into()].into();
        for ok in [
            "https://api.github.com/graphql",
            "https://api.github.com/repos/acme/web",
            "https://github.com/login/device/code",
            "https://github.com/login/oauth/access_token",
            "https://slack.com/api/search.messages",
            "https://slack.com/api/users.info",
            "https://ghe.example.com/api/graphql",
            "https://ghe.example.com/api/v3/rate_limit",
            "https://ghe2.example.com:8443/api/graphql",
        ] {
            assert!(fetch_allowed(ok, &hosts), "{ok}");
        }
        for bad in [
            "http://api.github.com/graphql",
            "https://user@api.github.com/graphql",
            "https://api.github.com.evil.com/graphql",
            "https://github.com/settings",
            "https://github.com/login/../settings",
            "https://slack.com/api/chat.postMessage",
            "https://slack.com/api/users.info?x=1",
            "https://evil.slack.com/api/users.info",
            "https://ghe.example.com/settings",
            "https://ghe.example.com:8443/api/graphql",
            "https://ghe2.example.com/api/graphql",
            "https://other.example.com/api/graphql",
            "not a url",
        ] {
            assert!(!fetch_allowed(bad, &hosts), "{bad}");
        }
    }
}
