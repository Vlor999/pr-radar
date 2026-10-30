//! Version web locale : l'app sert son interface sur 127.0.0.1, ouverte dans un onglet du navigateur.
//! Le navigateur n'a pas l'IPC de Tauri : `/invoke/<cmd>` (liste fermée de commandes), `/fetch`
//! (requête faite ici, mêmes hôtes que le plugin HTTP) et `/kv` (copie des réglages partagés).

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, TcpListener};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

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
/// Ancienne entrée du trousseau (secret permanent du lien, avant les tickets) : effacée à la désinstallation,
/// jamais lisible par le navigateur.
const SECRET_ACCOUNT: &str = "web-secret";
const COOKIE: &str = "pr_radar_web";
/// Durée de vie d'un ticket du lien : le temps que le navigateur s'ouvre.
const TICKET_TTL: Duration = Duration::from_secs(60);
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
const FETCH_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);
/// Plus grosse réponse transmise au navigateur (une page GraphQL de PR fait quelques centaines de Ko).
const FETCH_MAX_BYTES: usize = 20 * 1024 * 1024;
/// Clés partagées : même règle que `isSynced` (src/lib/sync.ts).
const KV_PREFIX: &str = "pr-radar:";
const KV_SEEN: &str = "pr-seen";
const KV_LOCAL_ONLY: [&str; 3] = [
    "pr-radar:theme",
    "pr-radar:last-notification",
    "pr-radar:mcp-history",
];
/// Taille totale de la copie partagée (clés + valeurs), sous le quota de localStorage (~5 Mo).
const KV_MAX_BYTES: usize = 4 * 1024 * 1024;
/// Comptes enregistrés (src/lib/auth.ts) : seuls leurs hôtes peuvent être autorisés depuis le navigateur.
const ACCOUNTS_KEY: &str = "pr-radar:accounts";

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

/* ---------- Copie partagée (KV) ---------- */

fn kv_key_ok(k: &str) -> bool {
    (k.starts_with(KV_PREFIX) || k == KV_SEEN) && !KV_LOCAL_ONLY.contains(&k)
}

#[derive(Default)]
struct Kv {
    /// faux tant que la fenêtre de l'app n'a pas envoyé son instantané (lancement)
    seeded: bool,
    map: HashMap<String, String>,
}

impl Kv {
    fn size(map: &HashMap<String, String>) -> usize {
        map.iter().map(|(k, v)| k.len() + v.len()).sum()
    }

    /// Écritures (`None` : clé effacée) ; clés non partagées ignorées ; refusées en bloc au-delà de la taille maximale.
    fn apply(&mut self, entries: HashMap<String, Option<String>>) -> Result<(), String> {
        let mut next = self.map.clone();
        for (k, v) in entries.into_iter().filter(|(k, _)| kv_key_ok(k)) {
            match v {
                Some(v) => next.insert(k, v),
                None => next.remove(&k),
            };
        }
        if Self::size(&next) > KV_MAX_BYTES {
            return Err("shared storage full".into());
        }
        self.map = next;
        Ok(())
    }

    /// Instantané de la fenêtre de l'app : référence au lancement ; ensuite (rechargement de la fenêtre)
    /// les valeurs déjà présentes, écrites entre-temps par le navigateur, sont gardées.
    fn seed(&mut self, entries: HashMap<String, String>) -> Result<(), String> {
        let mut next = if self.seeded {
            self.map.clone()
        } else {
            HashMap::new()
        };
        for (k, v) in entries.into_iter().filter(|(k, _)| kv_key_ok(k)) {
            next.entry(k).or_insert(v);
        }
        if Self::size(&next) > KV_MAX_BYTES {
            return Err("shared storage full".into());
        }
        self.map = next;
        self.seeded = true;
        Ok(())
    }

    fn snapshot(&self) -> Result<HashMap<String, String>, String> {
        if self.seeded {
            Ok(self.map.clone())
        } else {
            Err("not seeded".into())
        }
    }
}

/* ---------- État ---------- */

struct Server {
    port: u16,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub struct Web {
    server: Mutex<Option<Server>>,
    /// un seul `web_configure` à la fois (arrêt, attente du port, démarrage)
    configure: tauri::async_runtime::Mutex<()>,
    /// incrémenté à chaque arrêt : une connexion restée ouverte vers l'ancien serveur est refusée
    generation: AtomicU64,
    error: Mutex<Option<String>>,
    tickets: Mutex<Tickets>,
    sessions: Mutex<Sessions>,
    /// hôtes GitHub Enterprise autorisés par `allow_host`
    hosts: Arc<Mutex<HashSet<String>>>,
    kv: Mutex<Kv>,
    client: OnceLock<Option<reqwest::Client>>,
}

fn state(app: &AppHandle) -> &Web {
    app.state::<Web>().inner()
}

pub fn host_allowed(app: &AppHandle, host: &str) -> bool {
    state(app).hosts.lock().unwrap().contains(host)
}

/// Hôte GitHub Enterprise que `/fetch` peut joindre (après l'ajout de la capacité).
pub fn allow(app: &AppHandle, host: &str) {
    state(app).hosts.lock().unwrap().insert(host.to_string());
}

pub fn running(app: &AppHandle) -> bool {
    state(app).server.lock().unwrap().is_some()
}

/* ---------- Tickets du lien, sessions ---------- */

fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Comparaison en temps constant (longueurs publiques).
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Tickets du lien ouvert par l'app : aléatoires, une minute, un seul usage.
#[derive(Default)]
struct Tickets(Vec<(String, Instant)>);

impl Tickets {
    fn issue(&mut self, now: Instant) -> Result<String, String> {
        self.0.retain(|(_, exp)| *exp > now);
        let t = random_hex()?;
        self.0.push((t.clone(), now + TICKET_TTL));
        Ok(t)
    }

    /// Vrai si le ticket est connu et pas expiré ; il ne vaut plus rien ensuite.
    fn take(&mut self, given: &str, now: Instant) -> bool {
        let found = self
            .0
            .iter()
            .position(|(t, exp)| same(t.as_bytes(), given.as_bytes()) && *exp > now);
        found.map(|i| self.0.remove(i)).is_some()
    }

    fn revoke_all(&mut self) {
        self.0.clear();
    }
}

/// Sessions des navigateurs : valeur aléatoire par ticket échangé (les cookies de 127.0.0.1 partent vers
/// tous ses ports, le ticket n'y est donc jamais). En mémoire : perdues à l'arrêt du serveur.
#[derive(Default)]
struct Sessions(HashSet<String>);

impl Sessions {
    fn issue(&mut self) -> Result<String, String> {
        let s = random_hex()?;
        self.0.insert(s.clone());
        Ok(s)
    }

    /// Un cookie de session porte une session ouverte.
    fn valid<'a>(&self, cookies: impl Iterator<Item = &'a str>) -> bool {
        cookies
            .flat_map(|c| c.split(';'))
            .filter_map(|p| p.trim().split_once('='))
            .any(|(k, v)| k == COOKIE && self.0.iter().any(|s| same(v.as_bytes(), s.as_bytes())))
    }

    fn revoke_all(&mut self) {
        self.0.clear();
    }
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

/// Contrôles d'une requête, dans l'ordre : serveur encore actif, Host et Origin, session (API).
fn admit(
    current: bool,
    port: u16,
    host: Option<&str>,
    origin: Option<&str>,
    api: bool,
    session: impl FnOnce() -> bool,
) -> Result<(), StatusCode> {
    if !current {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    if !host_ok(host, port) || !origin_ok(origin, host.unwrap_or_default()) {
        return Err(StatusCode::FORBIDDEN);
    }
    if api && !session() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
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

/// `allow_host` depuis le navigateur : un nom de domaine public (pas d'IP, de nom sans point, de
/// localhost), et seulement l'hôte d'un compte déjà enregistré dans l'app.
fn browser_host_ok(host: &str, accounts: Option<&str>) -> bool {
    let name = host.split_once(':').map_or(host, |(n, _)| n);
    let public = name.contains('.')
        && name.parse::<IpAddr>().is_err()
        && !name.bytes().all(|b| b.is_ascii_digit() || b == b'.')
        && name != "localhost"
        && !name.ends_with(".localhost")
        && !name.ends_with(".local");
    let known = accounts
        .and_then(|a| serde_json::from_str::<Vec<Value>>(a).ok())
        .is_some_and(|list| {
            list.iter()
                .any(|a| a.get("host").and_then(Value::as_str) == Some(host))
        });
    public && known
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

#[derive(Debug, PartialEq)]
enum Redirect {
    Follow,
    Stop,
    TooMany,
}

/// Redirection d'une requête de `/fetch` : seulement vers une adresse autorisée elle aussi.
fn redirect(previous: usize, url: &str, hosts: &HashSet<String>) -> Redirect {
    if previous >= MAX_REDIRECTS {
        Redirect::TooMany
    } else if fetch_allowed(url, hosts) {
        Redirect::Follow
    } else {
        Redirect::Stop
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

#[allow(clippy::result_large_err)]
fn guard(ctx: &Ctx, headers: &HeaderMap, api: bool) -> Result<(), Response> {
    let web = state(&ctx.app);
    let text = |h| headers.get(h).and_then(|v: &HeaderValue| v.to_str().ok());
    let current = web.generation.load(Ordering::SeqCst) == ctx.generation;
    admit(
        current,
        ctx.port,
        text(header::HOST),
        text(header::ORIGIN),
        api,
        || {
            let cookies = headers
                .get_all(header::COOKIE)
                .iter()
                .filter_map(|v| v.to_str().ok());
            web.sessions.lock().unwrap().valid(cookies)
        },
    )
    .map_err(|code| {
        if code == StatusCode::SERVICE_UNAVAILABLE {
            // serveur arrêté : la connexion encore ouverte est fermée
            (code, [(header::CONNECTION, "close")]).into_response()
        } else {
            status(code)
        }
    })
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

/// Échange le ticket du lien (`#k=…`) contre un cookie de session.
async fn auth(State(ctx): State<Ctx>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = guard(&ctx, &headers, false) {
        return r;
    }
    let given = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|v| v.get("ticket")?.as_str().map(str::to_owned))
        .unwrap_or_default();
    let web = state(&ctx.app);
    if !web.tickets.lock().unwrap().take(&given, Instant::now()) {
        return status(StatusCode::UNAUTHORIZED);
    }
    let Ok(session) = web.sessions.lock().unwrap().issue() else {
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    };
    (
        StatusCode::NO_CONTENT,
        [
            (
                header::SET_COOKIE,
                format!("{COOKIE}={session}; HttpOnly; SameSite=Strict; Path=/"),
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
        "allow_host" => {
            let host = arg("host")?;
            let accounts = state(app).kv.lock().unwrap().map.get(ACCOUNTS_KEY).cloned();
            if !browser_host_ok(&host, accounts.as_deref()) {
                return Err(format!("host not allowed: {host}"));
            }
            crate::allow_host(app.clone(), host).map(|()| Value::Null)
        }
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

/// Client de `/fetch`, créé une fois ; `None` si sa création a échoué.
fn client(app: &AppHandle) -> Option<&reqwest::Client> {
    let web = state(app);
    web.client
        .get_or_init(|| {
            let hosts = web.hosts.clone();
            reqwest::Client::builder()
                .connect_timeout(FETCH_CONNECT_TIMEOUT)
                .timeout(FETCH_TIMEOUT)
                .redirect(reqwest::redirect::Policy::custom(move |a| {
                    let hosts = hosts.lock().unwrap().clone();
                    match redirect(a.previous().len(), a.url().as_str(), &hosts) {
                        Redirect::Follow => a.follow(),
                        Redirect::Stop => a.stop(),
                        Redirect::TooMany => a.error("too many redirects"),
                    }
                }))
                .build()
                .ok()
        })
        .as_ref()
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
    let Some(client) = client(&ctx.app) else {
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    };
    let mut out = client.request(method, &req.url);
    for (k, v) in forwarded_headers(req.headers) {
        out = out.header(k, v);
    }
    if let Some(b) = req.body {
        out = out.body(b);
    }
    let mut res = match out.send().await {
        Ok(r) => r,
        Err(e) => return json_response(StatusCode::BAD_GATEWAY, &json!(e.to_string())),
    };
    let code = res.status().as_u16();
    let headers: Vec<(String, String)> = res
        .headers()
        .iter()
        .filter_map(|(k, v)| Some((k.to_string(), v.to_str().ok()?.to_string())))
        .collect();
    let mut bytes = Vec::new();
    loop {
        match res.chunk().await {
            Ok(Some(c)) if bytes.len() + c.len() <= FETCH_MAX_BYTES => bytes.extend_from_slice(&c),
            Ok(Some(_)) => {
                return json_response(StatusCode::BAD_GATEWAY, &json!("response too large"));
            }
            Ok(None) => break,
            Err(e) => return json_response(StatusCode::BAD_GATEWAY, &json!(e.to_string())),
        }
    }
    json_response(
        StatusCode::OK,
        &json!({ "status": code, "headers": headers, "body": String::from_utf8_lossy(&bytes) }),
    )
}

/// Copie des réglages partagés : lecture (503 tant que l'app n'a pas envoyé son instantané).
async fn kv_get(State(ctx): State<Ctx>, headers: HeaderMap) -> Response {
    if let Err(r) = guard(&ctx, &headers, true) {
        return r;
    }
    match state(&ctx.app).kv.lock().unwrap().snapshot() {
        Ok(map) => json_response(StatusCode::OK, &json!(map)),
        Err(_) => status(StatusCode::SERVICE_UNAVAILABLE),
    }
}

/// Copie des réglages partagés : écritures du navigateur (`null` : clé effacée).
async fn kv_post(State(ctx): State<Ctx>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = guard(&ctx, &headers, true) {
        return r;
    }
    let Ok(entries) = serde_json::from_slice::<HashMap<String, Option<String>>>(&body) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let mut kv = state(&ctx.app).kv.lock().unwrap();
    if !kv.seeded {
        return status(StatusCode::SERVICE_UNAVAILABLE);
    }
    match kv.apply(entries) {
        Ok(()) => status(StatusCode::NO_CONTENT),
        Err(e) => json_response(StatusCode::PAYLOAD_TOO_LARGE, &json!(e)),
    }
}

/* ---------- Démarrage, arrêt ---------- */

fn start(app: &AppHandle, port: u16) -> Result<(), String> {
    // un serveur encore en place (appel direct) est arrêté avant
    let _ = stop(app);
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

/// Arrête le serveur, ferme sessions et tickets ; renvoie sa tâche, à attendre pour que le port soit libéré.
fn stop(app: &AppHandle) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let web = state(app);
    web.generation.fetch_add(1, Ordering::SeqCst);
    web.sessions.lock().unwrap().revoke_all();
    web.tickets.lock().unwrap().revoke_all();
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

/// Désinstallation : serveur arrêté, copie partagée vidée, ancienne entrée du trousseau effacée.
pub fn forget(app: &AppHandle) -> Result<(), String> {
    let _ = stop(app);
    *state(app).kv.lock().unwrap() = Kv::default();
    match crate::entry(SECRET_ACCOUNT)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Ouvre l'interface dans le navigateur du système, avec un ticket à usage unique dans le fragment
/// (jamais envoyé au serveur par une requête de page).
pub fn open(app: &AppHandle) -> Result<(), String> {
    let port = state(app)
        .server
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.port)
        .ok_or("web server not running")?;
    let ticket = state(app).tickets.lock().unwrap().issue(Instant::now())?;
    app.opener()
        .open_url(format!("http://127.0.0.1:{port}/#k={ticket}"), None::<&str>)
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
    let _one = state(&app).configure.lock().await;
    save_config(&app, Config { enabled, port })?;
    if let Some(task) = stop(&app) {
        let _ = task.await;
    }
    set_error(&app, None);
    if enabled && let Err(e) = start(&app, port) {
        set_error(&app, Some(e));
    }
    crate::refresh_tray(&app);
    web_status(app.clone())
}

/// Déconnecte tous les navigateurs : sessions et tickets en cours fermés.
#[tauri::command]
pub fn web_revoke(app: AppHandle) -> Result<(), String> {
    let web = state(&app);
    web.sessions.lock().unwrap().revoke_all();
    web.tickets.lock().unwrap().revoke_all();
    Ok(())
}

#[tauri::command]
pub fn web_open(app: AppHandle) -> Result<(), String> {
    open(&app)
}

/// Lancement (ou rechargement) de la fenêtre : son localStorage alimente la copie partagée.
#[tauri::command]
pub fn kv_seed(app: AppHandle, entries: HashMap<String, String>) -> Result<(), String> {
    state(&app).kv.lock().unwrap().seed(entries)
}

#[tauri::command]
pub fn kv_push(app: AppHandle, entries: HashMap<String, Option<String>>) -> Result<(), String> {
    state(&app).kv.lock().unwrap().apply(entries)
}

/// Erreur tant que la copie n'a pas reçu l'instantané de la fenêtre : rien n'est appliqué.
#[tauri::command]
pub fn kv_pull(app: AppHandle) -> Result<HashMap<String, String>, String> {
    state(&app).kv.lock().unwrap().snapshot()
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

    const HOST: Option<&str> = Some("127.0.0.1:14200");

    #[test]
    fn admit_order() {
        let ok = || true;
        let no = || false;
        assert_eq!(admit(true, 14200, HOST, None, true, ok), Ok(()));
        assert_eq!(admit(true, 14200, HOST, None, false, no), Ok(()));
        assert_eq!(
            admit(false, 14200, HOST, None, true, ok),
            Err(StatusCode::SERVICE_UNAVAILABLE)
        );
        assert_eq!(
            admit(true, 14200, Some("evil.com:14200"), None, true, ok),
            Err(StatusCode::FORBIDDEN)
        );
        assert_eq!(
            admit(true, 14200, HOST, Some("http://evil.com"), true, ok),
            Err(StatusCode::FORBIDDEN)
        );
        assert_eq!(
            admit(true, 14200, HOST, None, true, no),
            Err(StatusCode::UNAUTHORIZED)
        );
    }

    #[test]
    fn ticket_is_single_use() {
        let now = Instant::now();
        let mut t = Tickets::default();
        let id = t.issue(now).unwrap();
        assert!(t.take(&id, now));
        assert!(!t.take(&id, now));
    }

    #[test]
    fn ticket_expires() {
        let now = Instant::now();
        let mut t = Tickets::default();
        let id = t.issue(now).unwrap();
        assert!(!t.take(&id, now + TICKET_TTL));
    }

    #[test]
    fn unknown_or_revoked_ticket_is_refused() {
        let now = Instant::now();
        let mut t = Tickets::default();
        let id = t.issue(now).unwrap();
        assert!(!t.take("", now));
        assert!(!t.take(&id[1..], now));
        t.revoke_all();
        assert!(!t.take(&id, now));
    }

    #[test]
    fn issued_session_is_accepted() {
        let mut s = Sessions::default();
        let id = s.issue().unwrap();
        let ok = |c: &str| s.valid([c].into_iter());
        assert!(ok(&format!("pr_radar_web={id}")));
        assert!(ok(&format!("a=1; pr_radar_web={id}; b=2")));
        assert!(s.valid(["a=1", &*format!("pr_radar_web={id}")].into_iter()));
    }

    #[test]
    fn unknown_session_is_refused() {
        let mut s = Sessions::default();
        let id = s.issue().unwrap();
        let ok = |c: &str| s.valid([c].into_iter());
        assert!(!s.valid(std::iter::empty()));
        assert!(!ok("pr_radar_web=other"));
        assert!(!ok(&format!("pr_radar_web={}", &id[1..])));
        assert!(!ok("pr_radar_web="));
        assert!(!ok(&format!("x_pr_radar_web={id}")));
        assert!(!Sessions::default().valid([&*format!("pr_radar_web={id}")].into_iter()));
    }

    #[test]
    fn sessions_are_distinct_and_revoked_together() {
        let mut s = Sessions::default();
        let (a, b) = (s.issue().unwrap(), s.issue().unwrap());
        assert_ne!(a, b);
        s.revoke_all();
        for id in [a, b] {
            assert!(!s.valid([&*format!("pr_radar_web={id}")].into_iter()));
        }
    }

    #[test]
    fn random_values_differ_and_are_hex() {
        let (a, b) = (random_hex().unwrap(), random_hex().unwrap());
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
            "web_revoke",
            "kv_seed",
            "plugin:notification|notify",
        ] {
            assert!(!command_allowed(cmd, Some("slack:T1")), "{cmd}");
        }
    }

    #[test]
    fn browser_host_filter() {
        let accounts = r#"[{"id":"a","host":"ghe.example.com"},{"id":"b","host":"ghe2.example.com:8443"},{"id":"c","host":"10.0.0.1"},{"id":"d","host":"intranet"},{"id":"e","host":"localhost"},{"id":"f","host":"x.localhost"},{"id":"g","host":"nas.local"}]"#;
        assert!(browser_host_ok("ghe.example.com", Some(accounts)));
        assert!(browser_host_ok("ghe2.example.com:8443", Some(accounts)));
        for bad in [
            "10.0.0.1",
            "intranet",
            "localhost",
            "x.localhost",
            "nas.local",
            "other.example.com",
        ] {
            assert!(!browser_host_ok(bad, Some(accounts)), "{bad}");
        }
        assert!(!browser_host_ok("ghe.example.com", None));
        assert!(!browser_host_ok("ghe.example.com", Some("not json")));
        assert!(!browser_host_ok(
            "192.168.1.10",
            Some(r#"[{"host":"192.168.1.10"}]"#)
        ));
        assert!(!browser_host_ok(
            "169.254.1.1",
            Some(r#"[{"host":"169.254.1.1"}]"#)
        ));
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

    fn hosts() -> HashSet<String> {
        ["ghe.example.com".into(), "ghe2.example.com:8443".into()].into()
    }

    #[test]
    fn fetch_allowlist() {
        let hosts = hosts();
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

    #[test]
    fn redirect_decision() {
        let hosts = hosts();
        assert_eq!(
            redirect(0, "https://api.github.com/repositories/1", &hosts),
            Redirect::Follow
        );
        assert_eq!(
            redirect(0, "https://evil.com/api/x", &hosts),
            Redirect::Stop
        );
        assert_eq!(
            redirect(MAX_REDIRECTS, "https://api.github.com/x", &hosts),
            Redirect::TooMany
        );
    }

    fn entries(v: &[(&str, Option<&str>)]) -> HashMap<String, Option<String>> {
        v.iter()
            .map(|(k, v)| (k.to_string(), v.map(str::to_string)))
            .collect()
    }

    fn seed(v: &[(&str, &str)]) -> HashMap<String, String> {
        v.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn kv_is_unavailable_until_seeded() {
        assert!(Kv::default().snapshot().is_err());
        let mut kv = Kv::default();
        kv.seed(seed(&[("pr-radar:repos", "[]")])).unwrap();
        assert_eq!(kv.snapshot().unwrap(), seed(&[("pr-radar:repos", "[]")]));
    }

    #[test]
    fn kv_apply_writes_deletes_and_filters_keys() {
        let mut kv = Kv::default();
        kv.seed(seed(&[("pr-radar:repos", "[]"), ("pr-seen", "{}")]))
            .unwrap();
        kv.apply(entries(&[
            ("pr-radar:repos", Some("[\"a/b\"]")),
            ("pr-seen", None),
            ("pr-radar:theme", Some("dark")),
            ("other", Some("x")),
        ]))
        .unwrap();
        assert_eq!(
            kv.snapshot().unwrap(),
            seed(&[("pr-radar:repos", "[\"a/b\"]")])
        );
    }

    #[test]
    fn kv_refuses_writes_past_the_size_limit() {
        let mut kv = Kv::default();
        kv.seed(seed(&[("pr-radar:repos", "[]")])).unwrap();
        let big = "x".repeat(KV_MAX_BYTES);
        assert!(kv.apply(entries(&[("pr-radar:big", Some(&big))])).is_err());
        assert_eq!(kv.snapshot().unwrap(), seed(&[("pr-radar:repos", "[]")]));
    }

    #[test]
    fn kv_reseed_keeps_values_written_meanwhile() {
        let mut kv = Kv::default();
        kv.seed(seed(&[
            ("pr-radar:settings", "old"),
            ("pr-radar:repos", "[]"),
        ]))
        .unwrap();
        kv.apply(entries(&[("pr-radar:settings", Some("browser"))]))
            .unwrap();
        kv.seed(seed(&[
            ("pr-radar:settings", "old"),
            ("pr-radar:accounts", "[]"),
        ]))
        .unwrap();
        assert_eq!(
            kv.snapshot().unwrap(),
            seed(&[
                ("pr-radar:settings", "browser"),
                ("pr-radar:repos", "[]"),
                ("pr-radar:accounts", "[]"),
            ])
        );
    }

    #[test]
    fn kv_first_seed_ignores_local_only_keys() {
        let mut kv = Kv::default();
        kv.seed(seed(&[("pr-radar:theme", "dark"), ("pr-seen", "{}")]))
            .unwrap();
        assert_eq!(kv.snapshot().unwrap(), seed(&[("pr-seen", "{}")]));
    }
}
