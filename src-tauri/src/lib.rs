use keyring::{Entry, Error};

fn entry() -> Result<Entry, String> {
    Entry::new("io.github.vlor999.prradar", "github").map_err(|e| e.to_string())
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
/// Une app lancée depuis le Finder n'a pas le PATH du terminal : on essaie aussi les emplacements usuels.
#[tauri::command]
fn gh_token() -> Option<String> {
    let candidates = [
        "gh",
        "/opt/homebrew/bin/gh",
        "/usr/local/bin/gh",
        "/usr/bin/gh",
        "/home/linuxbrew/.linuxbrew/bin/gh",
        "C:\\Program Files\\GitHub CLI\\gh.exe",
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![get_token, set_token, delete_token, gh_token])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
