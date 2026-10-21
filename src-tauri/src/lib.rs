use keyring::{Entry, Error};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const ID: &str = "io.github.vlor999.prradar";

fn entry() -> Result<Entry, String> {
    Entry::new(ID, "github").map_err(|e| e.to_string())
}

#[tauri::command]
fn get_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn set_token(token: String) -> Result<(), String> {
    entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
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
    delete_token()?;
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

fn tray_menu(app: &AppHandle, open: &str, quit: &str) -> tauri::Result<Menu<tauri::Wry>> {
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", open, true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", quit, true, None::<&str>)?,
        ],
    )
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
        .menu(&tray_menu(app, "Open PR Radar", "Quit")?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => show_main(app),
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
) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY).ok_or("no tray")?;
    let e = |e: tauri::Error| e.to_string();
    tray.set_title((count > 0).then(|| count.to_string()))
        .map_err(e)?;
    tray.set_tooltip(Some(tooltip)).map_err(e)?;
    tray.set_menu(Some(tray_menu(&app, &open, &quit).map_err(e)?))
        .map_err(e)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| Ok(setup_tray(app.handle())?))
        .invoke_handler(tauri::generate_handler![
            get_token,
            set_token,
            delete_token,
            gh_token,
            uninstall_plan,
            uninstall_run,
            set_tray
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
