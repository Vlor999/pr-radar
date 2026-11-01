//! Détection des plantages : un marqueur « session en cours » (`session.json`, dossier de données de
//! l'app) est écrit au lancement et supprimé à la fermeture propre. Présent au lancement suivant : la
//! session précédente s'est mal terminée. Un panic Rust est noté dans ce marqueur et dans le journal.
//! Rien n'est envoyé : l'interface propose seulement d'ouvrir une issue préremplie.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::log;

const MARKER: &str = "session.json";
/// dernier dossier du journal passé par l'interface : un panic avant toute commande l'utilise aussi
const LOG_DIR_FILE: &str = "log-dir.txt";
/// message de panic et backtrace tronqués au-delà
const MAX_PANIC_CHARS: usize = 2_000;

/// Panic noté par le hook (le dernier de la session).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Panic {
    pub ts: i64,
    pub message: String,
    pub location: Option<String>,
}

/// Contenu du marqueur.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// lancement (ms depuis l'époque Unix) ; 0 : marqueur illisible
    pub started_at: i64,
    #[serde(default)]
    pub panic: Option<Panic>,
}

struct Paths {
    data: PathBuf,
    default_log: PathBuf,
}

static PATHS: OnceLock<Paths> = OnceLock::new();
/// dernier dossier du journal résolu (commandes `log_*`) ; None = celui par défaut
static LOG_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
/// session précédente mal terminée (lue au lancement)
static PREVIOUS: Mutex<Option<Session>> = Mutex::new(None);
/// lancement de cette session
static STARTED_AT: OnceLock<i64> = OnceLock::new();

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/* ---------- Marqueur (fonctions pures sur un dossier, testées) ---------- */

fn write_marker(data: &Path, s: &Session) -> Result<(), String> {
    fs::create_dir_all(data).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(s).map_err(|e| e.to_string())?;
    fs::write(data.join(MARKER), text).map_err(|e| e.to_string())
}

fn read_marker(data: &Path) -> Option<Session> {
    let text = fs::read_to_string(data.join(MARKER)).ok()?;
    // présent mais illisible (écriture interrompue) : session mal terminée quand même
    Some(serde_json::from_str(&text).unwrap_or(Session {
        started_at: 0,
        panic: None,
    }))
}

/// Lancement : session précédente si son marqueur est resté, puis marqueur de cette session.
fn begin(data: &Path, now: i64) -> Option<Session> {
    let previous = read_marker(data);
    let _ = write_marker(
        data,
        &Session {
            started_at: now,
            panic: None,
        },
    );
    previous
}

/// Fermeture propre : marqueur supprimé.
fn end(data: &Path) {
    let _ = fs::remove_file(data.join(MARKER));
}

/// Panic noté dans le marqueur (recréé s'il manque : le prochain lancement le verra).
fn note_panic(data: &Path, started_at: i64, panic: Panic) {
    let mut s = read_marker(data).unwrap_or(Session {
        started_at,
        panic: None,
    });
    s.panic = Some(panic);
    let _ = write_marker(data, &s);
}

fn load_log_dir(data: &Path) -> Option<PathBuf> {
    let p = PathBuf::from(fs::read_to_string(data.join(LOG_DIR_FILE)).ok()?.trim());
    p.is_absolute().then_some(p)
}

/// `None` : dossier par défaut (fichier supprimé).
fn save_log_dir(data: &Path, dir: Option<&Path>) {
    let file = data.join(LOG_DIR_FILE);
    let _ = match dir {
        Some(d) => {
            fs::create_dir_all(data).and_then(|()| fs::write(&file, d.to_string_lossy().as_bytes()))
        }
        None => fs::remove_file(&file),
    };
}

fn truncate(s: &str) -> String {
    match s.char_indices().nth(MAX_PANIC_CHARS) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

/* ---------- Branchement dans l'app ---------- */

/// Dossier résolu par une commande du journal : gardé pour le hook de panic (et pour le prochain lancement).
pub fn remember_log_dir(dir: &Path) {
    let Some(paths) = PATHS.get() else { return };
    let chosen = (dir != paths.default_log).then(|| dir.to_path_buf());
    let mut cur = LOG_DIR.lock().unwrap_or_else(|e| e.into_inner());
    if *cur != chosen {
        save_log_dir(&paths.data, chosen.as_deref());
        *cur = chosen;
    }
}

fn on_panic(info: &std::panic::PanicHookInfo) {
    let Some(paths) = PATHS.get() else { return };
    let payload = info.payload();
    let message = payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panic".into());
    let message = truncate(&message);
    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
    // seulement avec RUST_BACKTRACE (sinon rien à capturer : aucun coût)
    let bt = std::backtrace::Backtrace::capture();
    let backtrace = (bt.status() == std::backtrace::BacktraceStatus::Captured)
        .then(|| truncate(&bt.to_string()));
    let ts = now_ms();
    note_panic(
        &paths.data,
        STARTED_AT.get().copied().unwrap_or(ts),
        Panic {
            ts,
            message: message.clone(),
            location: location.clone(),
        },
    );
    // verrou peut-être tenu par le fil qui panique : pas d'attente
    let dir = LOG_DIR
        .try_lock()
        .ok()
        .and_then(|d| d.clone())
        .unwrap_or_else(|| paths.default_log.clone());
    let thread = std::thread::current().name().map(str::to_string);
    let _ = log::append_from_panic(
        &dir,
        log::Entry {
            ts,
            level: "error".into(),
            event: "app.panic".into(),
            data: json!({
                "message": message,
                "location": location,
                "thread": thread,
                "backtrace": backtrace,
            }),
        },
    );
}

/// Au lancement : session précédente lue, marqueur écrit, hook de panic installé (avant le hook par défaut).
pub fn init(app: &AppHandle) {
    let path = app.path();
    let (Ok(data), Ok(default_log)) = (path.app_data_dir(), path.app_log_dir()) else {
        return;
    };
    let now = now_ms();
    let _ = STARTED_AT.set(now);
    *LOG_DIR.lock().unwrap_or_else(|e| e.into_inner()) = load_log_dir(&data);
    *PREVIOUS.lock().unwrap_or_else(|e| e.into_inner()) = begin(&data, now);
    let _ = PATHS.set(Paths { data, default_log });
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        on_panic(info);
        default_hook(info);
    }));
}

/// Fermeture propre (`RunEvent::Exit` : Quitter, désinstallation, redémarrage après mise à jour).
pub fn shutdown() {
    if let Some(p) = PATHS.get() {
        end(&p.data);
    }
}

/* ---------- Commandes ---------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashStatus {
    /// session précédente mal terminée, None si elle s'est fermée proprement
    previous: Option<Session>,
    /// lancement de cette session
    started_at: i64,
}

/// Lu une fois : l'interface le garde pour la session (une fenêtre rechargée ne le revoit pas).
#[tauri::command]
pub fn crash_status() -> Result<CrashStatus, String> {
    Ok(CrashStatus {
        previous: PREVIOUS.lock().map_err(|e| e.to_string())?.take(),
        started_at: STARTED_AT.get().copied().unwrap_or(0),
    })
}

/// Fermeture annoncée par l'interface : Windows, l'installeur de mise à jour quitte l'app par
/// `std::process::exit` (sans `RunEvent::Exit`). `clean: false` (installation ratée) remet le marqueur.
#[tauri::command]
pub fn session_clean(clean: bool) -> Result<(), String> {
    let p = PATHS.get().ok_or("session not started")?;
    if clean {
        end(&p.data);
        Ok(())
    } else {
        write_marker(
            &p.data,
            &Session {
                started_at: STARTED_AT.get().copied().unwrap_or(0),
                panic: None,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p =
            std::env::temp_dir().join(format!("pr-radar-crash-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        p
    }

    fn panic_at(ts: i64) -> Panic {
        Panic {
            ts,
            message: "boom".into(),
            location: Some("src/lib.rs:1:1".into()),
        }
    }

    #[test]
    fn clean_exit_leaves_no_previous_session() {
        let data = tmp("clean");
        assert_eq!(begin(&data, 1), None);
        end(&data);
        assert_eq!(begin(&data, 2), None);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn unclean_exit_is_reported_once() {
        let data = tmp("unclean");
        begin(&data, 1);
        assert_eq!(
            begin(&data, 2),
            Some(Session {
                started_at: 1,
                panic: None
            })
        );
        end(&data);
        assert_eq!(begin(&data, 3), None);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn panic_is_kept_for_next_launch() {
        let data = tmp("panic");
        begin(&data, 1);
        note_panic(&data, 1, panic_at(5));
        assert_eq!(
            begin(&data, 9),
            Some(Session {
                started_at: 1,
                panic: Some(panic_at(5))
            })
        );
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn panic_recreates_missing_marker() {
        let data = tmp("recreate");
        note_panic(&data, 4, panic_at(5));
        assert_eq!(begin(&data, 9).unwrap().started_at, 4);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn unreadable_marker_counts_as_unclean() {
        let data = tmp("corrupt");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join(MARKER), "{\"startedAt\":").unwrap();
        assert_eq!(
            begin(&data, 9),
            Some(Session {
                started_at: 0,
                panic: None
            })
        );
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn status_is_read_once() {
        *PREVIOUS.lock().unwrap() = Some(Session {
            started_at: 1,
            panic: None,
        });
        assert!(crash_status().unwrap().previous.is_some());
        assert!(crash_status().unwrap().previous.is_none());
    }

    #[test]
    fn log_dir_round_trip() {
        let data = tmp("logdir");
        assert_eq!(load_log_dir(&data), None);
        save_log_dir(&data, Some(Path::new("/var/logs/pr")));
        assert_eq!(load_log_dir(&data), Some(PathBuf::from("/var/logs/pr")));
        save_log_dir(&data, None);
        assert_eq!(load_log_dir(&data), None);
        fs::write(data.join(LOG_DIR_FILE), "relative/dir").unwrap();
        assert_eq!(load_log_dir(&data), None);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn long_message_is_truncated() {
        let long = "é".repeat(MAX_PANIC_CHARS + 5);
        let t = truncate(&long);
        assert_eq!(t.chars().count(), MAX_PANIC_CHARS + 1);
        assert!(t.ends_with('…'));
        assert_eq!(truncate("short"), "short");
    }
}
