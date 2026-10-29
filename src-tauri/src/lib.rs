use keyring::{Entry, Error};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, ipc::CapabilityBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

pub mod mcp;
mod web;

const ID: &str = "io.github.vlor999.prradar";
/// Compte d'origine (avant le multi-compte) : son entrée du trousseau garde ce nom.
const DEFAULT_ACCOUNT: &str = "github";

/// Une entrée du trousseau par compte (`github`, ou `login@hôte`).
fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(ID, account).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_token(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn set_token(account: String, token: String) -> Result<(), String> {
    entry(&account)?
        .set_password(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_token(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Nom d'hôte en minuscules (`ghe.example.com`, port optionnel) : rien qui élargisse le motif d'URL.
fn valid_host(host: &str) -> bool {
    let (name, port) = host.split_once(':').unwrap_or((host, "1"));
    let label = |l: &str| {
        !l.is_empty()
            && !l.starts_with('-')
            && !l.ends_with('-')
            && l.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    };
    name.split('.').all(label)
        && (1..=5).contains(&port.len())
        && port.bytes().all(|b| b.is_ascii_digit())
}

/// GitHub Enterprise : autorise le plugin HTTP à joindre `https://<hôte>/api/…`, et rien d'autre de cet hôte.
#[tauri::command]
fn allow_host(app: AppHandle, host: String) -> Result<(), String> {
    if !valid_host(&host) {
        return Err(format!("invalid host: {host}"));
    }
    // déjà autorisé (la version web relit les comptes) : rien à ajouter
    if !web::allow(&app, &host) {
        return Ok(());
    }
    let url = |p: &str| serde_json::json!({ "url": format!("https://{host}/api/{p}") });
    app.add_capability(
        CapabilityBuilder::new(format!("ghe-{host}"))
            .window("main")
            .permission_scoped("http:default", vec![url("*"), url("**")], vec![]),
    )
    .map_err(|e| e.to_string())
}

/// Jeton du CLI GitHub (`gh auth token`) s'il est installé et connecté : connexion sans aucune étape.
/// Une app lancée depuis le Finder n'a pas le PATH du terminal : on essaie d'abord les emplacements usuels.
#[tauri::command]
fn gh_token() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/gh",
        "/usr/local/bin/gh",
        "/usr/bin/gh",
        "/home/linuxbrew/.linuxbrew/bin/gh",
        "C:\\Program Files\\GitHub CLI\\gh.exe",
        "gh", // PATH en dernier recours : pas de binaire `gh` détourné via le PATH
    ];
    candidates.iter().find_map(|bin| {
        let mut cmd = std::process::Command::new(bin);
        cmd.args(["auth", "token", "--hostname", "github.com"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console qui clignote
        }
        let out = cmd.output().ok()?;
        let token = String::from_utf8(out.stdout).ok()?.trim().to_string();
        (out.status.success() && !token.is_empty()).then_some(token)
    })
}

/* ---------- Connexion Slack : retour OAuth par le lien profond `prradar://oauth?…` ---------- */

/// Transmet à l'interface la query string du retour Slack (elle vérifie `state`) et ramène la fenêtre.
fn on_deep_link(app: &AppHandle, urls: Vec<tauri::Url>) {
    for url in urls {
        if url.scheme() == "prradar" && url.host_str() == Some("oauth") {
            let _ = app.emit("slack-oauth", url.query().unwrap_or_default());
            show_main(app);
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UninstallPlan {
    /// Ce qui retire l'app : bundle .app / AppImage, ou `uninstall.exe` (lancé, pas supprimé) ; None si impossible.
    app_path: Option<String>,
    /// Dossiers et fichiers de données existants qui seront supprimés.
    data_paths: Vec<String>,
    /// Étape manuelle restante, traduite par l'interface : "linux-package" (.deb/.rpm) ou "windows-settings" (MSI).
    note: Option<&'static str>,
}

/// Garde-fou : chemin absolu, sans `..`, strictement sous le home (ou égal au bundle calculé), jamais `/`.
fn is_safe(p: &Path, home: &Path, bundle: Option<&Path>) -> bool {
    let clean = |x: &Path| {
        x.is_absolute()
            && x.parent().is_some()
            && !x.components().any(|c| c == Component::ParentDir)
    };
    clean(p) && ((clean(home) && p.starts_with(home) && p != home) || Some(p) == bundle)
}

/// Ce qui retire l'app elle-même, selon la façon dont elle a été installée.
fn app_removal() -> (Option<PathBuf>, Option<&'static str>) {
    #[cfg(target_os = "macos")]
    return (
        std::env::current_exe().ok().and_then(|e| {
            e.ancestors()
                .find(|a| a.extension().is_some_and(|x| x == "app"))
                .map(Path::to_path_buf)
        }),
        None,
    );
    #[cfg(target_os = "linux")]
    return match std::env::var_os("APPIMAGE") {
        Some(p) => (Some(p.into()), None),
        None => (None, Some("linux-package")),
    };
    #[cfg(windows)]
    return match std::env::current_exe()
        .ok()
        .and_then(|e| Some(e.parent()?.join("uninstall.exe")))
        .filter(|u| u.exists())
    {
        Some(u) => (Some(u), None),
        None => (None, Some("windows-settings")),
    };
}

/// Inventaire de ce que la désinstallation va retirer (affiché avant confirmation).
#[tauri::command]
fn uninstall_plan(app: AppHandle) -> UninstallPlan {
    let path = app.path();
    let home = path.home_dir().unwrap_or_default();
    // Linux (XDG) et Windows (%APPDATA%, %LOCALAPPDATA%\EBWebView) : couverts par les dossiers app_*.
    let mut data: Vec<PathBuf> = [
        path.app_data_dir(),
        path.app_local_data_dir(),
        path.app_config_dir(),
        path.app_cache_dir(),
        path.app_log_dir(),
    ]
    .into_iter()
    .flatten()
    .collect();
    #[cfg(target_os = "macos")]
    for rel in [
        format!("WebKit/{ID}"),
        "WebKit/pr-radar".into(),
        format!("HTTPStorages/{ID}"),
        format!("HTTPStorages/{ID}.binarycookies"),
        format!("Caches/{ID}"),
        format!("Saved Application State/{ID}.savedState"),
        format!("Preferences/{ID}.plist"),
    ] {
        data.push(home.join("Library").join(rel));
    }
    data.sort();
    data.dedup();
    data.retain(|p| p.exists() && is_safe(p, &home, None));
    let (app_path, note) = app_removal();
    let s = |p: &Path| p.to_string_lossy().into_owned();
    UninstallPlan {
        app_path: app_path.as_deref().map(s),
        data_paths: data.iter().map(|p| s(p)).collect(),
        note,
    }
}

/// Supprime le jeton, lance un nettoyeur détaché qui attend la fermeture de l'app, puis quitte.
#[tauri::command]
fn uninstall_run(app: AppHandle) -> Result<(), String> {
    delete_token(DEFAULT_ACCOUNT.into())?;
    let plan = uninstall_plan(app.clone());
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let bundle = plan.app_path.as_deref().map(Path::new);
    let data = plan
        .data_paths
        .iter()
        .map(Path::new)
        .filter(|p| is_safe(p, &home, None));

    #[cfg(unix)]
    let mut cmd = {
        use std::os::unix::process::CommandExt;
        let mut cmd = Command::new("sh");
        // Chemins passés en arguments séparés : aucune interpolation dans le script.
        cmd.args(["-c", "sleep 2; rm -rf -- \"$@\"", "sh"])
            .args(data.chain(bundle.filter(|b| is_safe(b, &home, Some(b)))))
            .process_group(0); // hors du groupe de l'app : survit à sa fermeture
        cmd
    };
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        // `timeout` échoue sans console (stdin redirigé) : `ping` sert de pause.
        let mut script = String::from("ping -n 3 127.0.0.1 >nul");
        for p in data.filter_map(Path::to_str).filter(|p| !p.contains('"')) {
            script += &format!(" & rmdir /s /q \"{p}\" 2>nul & del /f /q \"{p}\" 2>nul");
        }
        if let Some(u) = bundle.and_then(Path::to_str).filter(|u| !u.contains('"')) {
            script += &format!(" & start \"\" \"{u}\"");
        }
        let mut cmd = Command::new("cmd");
        cmd.arg("/S").arg("/C").raw_arg(format!("\"{script}\""));
        cmd.creation_flags(0x0800_0000 | 0x0000_0008); // CREATE_NO_WINDOW | DETACHED_PROCESS
        cmd
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        app.exit(0);
    });
    Ok(())
}

/* ---------- Icône de la barre des menus / zone de notification ---------- */

const TRAY: &str = "main";

/// Libellés du menu, dans la langue de l'app (envoyés par `set_tray`).
struct TrayLabels {
    open: String,
    quit: String,
    web: String,
}

impl Default for TrayLabels {
    fn default() -> Self {
        Self {
            open: "Open PR Radar".into(),
            quit: "Quit".into(),
            web: "Open in browser".into(),
        }
    }
}

/// « Ouvrir dans le navigateur » : seulement quand la version web tourne.
fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<Mutex<TrayLabels>>();
    let l = state.lock().unwrap();
    let menu = Menu::with_items(
        app,
        &[&MenuItem::with_id(
            app,
            "open",
            &l.open,
            true,
            None::<&str>,
        )?],
    )?;
    if web::running(app) {
        menu.append(&MenuItem::with_id(app, "web", &l.web, true, None::<&str>)?)?;
    }
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        &l.quit,
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

/// Menu reconstruit (langue, version web démarrée ou arrêtée).
fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    // glyphe PR du logo, blanc sur fond transparent ; modèle macOS : suit le thème de la barre des menus
    let tray = TrayIconBuilder::with_id(TRAY)
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true)
        .tooltip("PR Radar")
        .menu(&tray_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => show_main(app),
            "web" => {
                if let Err(e) = web::open(app) {
                    eprintln!("web version: {e}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = e
            {
                show_main(tray.app_handle());
            }
        });
    tray.build(app)?;
    Ok(())
}

/// Compteur (titre à côté de l'icône sur macOS, infobulle partout) et libellés du menu dans la langue de l'app.
#[tauri::command]
fn set_tray(
    app: AppHandle,
    count: usize,
    tooltip: String,
    open: String,
    quit: String,
    web: String,
) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY).ok_or("no tray")?;
    let e = |e: tauri::Error| e.to_string();
    tray.set_title((count > 0).then(|| count.to_string()))
        .map_err(e)?;
    tray.set_tooltip(Some(tooltip)).map_err(e)?;
    *app.state::<Mutex<TrayLabels>>().lock().unwrap() = TrayLabels { open, quit, web };
    tray.set_menu(Some(tray_menu(&app).map_err(e)?)).map_err(e)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // en premier (doc du plugin) : relancer l'app ramène la fenêtre au lieu d'ouvrir un second processus
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(web::Web::default())
        .manage(Mutex::new(TrayLabels::default()))
        .manage(mcp::McpState::default())
        .setup(|app| {
            // serveur MCP : verrou de présence pris au lancement, socket créé seulement si activé
            mcp::hold_lock(&app.state::<mcp::McpState>());
            // retour de la connexion Slack ; Windows/Linux : arrive par single-instance (feature deep-link)
            let handle = app.handle().clone();
            app.deep_link()
                .on_open_url(move |e| on_deep_link(&handle, e.urls()));
            // Windows/Linux (AppImage, dev) : enregistre le schéma `prradar` au lancement
            #[cfg(any(windows, target_os = "linux"))]
            if let Err(e) = app.deep_link().register_all() {
                eprintln!("deep link registration failed: {e}");
            }
            // version web activée : serveur démarré avant le menu (qui propose de l'ouvrir)
            web::autostart(app.handle());
            // sans barre d'icônes (ex. GNOME sans AppIndicator) l'app démarre quand même
            if let Err(e) = setup_tray(app.handle()) {
                eprintln!("tray unavailable: {e}");
            }
            Ok(())
        })
        // fermer la fenêtre la cache : l'app reste dans la barre des menus, « Quitter » (ou ⌘Q) la ferme.
        // Sans icône, la fermeture quitte (sinon plus aucun moyen de rouvrir l'app).
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = e
                && w.app_handle().tray_by_id(TRAY).is_some()
            {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_token,
            set_token,
            delete_token,
            allow_host,
            gh_token,
            uninstall_plan,
            uninstall_run,
            set_tray,
            web::web_status,
            web::web_configure,
            web::web_rotate_secret,
            web::web_open,
            web::kv_seed,
            web::kv_push,
            web::kv_pull,
            mcp::mcp_info,
            mcp::mcp_enable,
            mcp::mcp_disable,
            mcp::mcp_response
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, e| {
            // fermeture : serveur web arrêté, le socket MCP disparaît avec l'app
            if let tauri::RunEvent::Exit = e {
                web::shutdown(app);
                let _ = mcp::mcp_disable(app.state::<mcp::McpState>());
            }
            // clic sur l'icône du Dock alors que la fenêtre est cachée
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = e {
                show_main(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_filter() {
        assert!(valid_host("ghe.example.com"));
        assert!(valid_host("ghe.example.com:8443"));
        assert!(valid_host("localhost"));
        for bad in [
            "",
            "GHE.example.com",
            "ghe.example.com/",
            "*.example.com",
            "user@ghe.example.com",
            "ghe..example.com",
            "-ghe.example.com",
            "ghe.example.com:",
            "ghe.example.com:123456",
            "ghe.example.com:8443:1",
            "ghe.example.com?x",
        ] {
            assert!(!valid_host(bad), "{bad}");
        }
    }

    #[test]
    fn safety_filter() {
        let home = Path::new("/Users/me");
        assert!(is_safe(Path::new("/Users/me/Library/Caches/x"), home, None));
        assert!(!is_safe(home, home, None));
        assert!(!is_safe(Path::new("/"), home, None));
        assert!(!is_safe(Path::new(""), home, None));
        assert!(!is_safe(Path::new("/Users/me/../other"), home, None));
        assert!(!is_safe(
            Path::new("/Applications/PR Radar.app"),
            home,
            None
        ));
        let app = Path::new("/Applications/PR Radar.app");
        assert!(is_safe(app, home, Some(app)));
        assert!(!is_safe(Path::new("/Users/me/x"), Path::new(""), None));
    }
}
