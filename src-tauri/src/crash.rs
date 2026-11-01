//! Détection des plantages : un marqueur « session en cours » (`session.json`, dossier de données de
//! l'app) est écrit au lancement et supprimé à la fermeture propre. Présent au lancement suivant : la
//! session précédente s'est mal terminée. Un panic Rust est noté dans ce marqueur et dans le journal.
//! Un marqueur d'une session lancée avant le démarrage actuel du système (arrêt ou fermeture de session
//! sans `RunEvent::Exit`) n'est pas un plantage, sauf s'il note un panic.
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
/// marge sur l'heure de démarrage du système (dérivée de l'horloge : NTP, réglage)
const BOOT_TOLERANCE_MS: i64 = 120_000;
/// SIGTERM / SIGHUP : délai laissé à la fermeture normale avant de quitter de force (boucle bloquée)
const SIGNAL_EXIT_GRACE_MS: u64 = 5_000;

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

impl Session {
    fn new(started_at: i64) -> Self {
        Self {
            started_at,
            panic: None,
        }
    }
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

/// Heure de démarrage du système (ms depuis l'époque Unix), None si elle ne peut pas être lue.
/// Windows : avec le démarrage rapide (réglage par défaut), « Arrêter » met le système en veille
/// prolongée sans remettre `GetTickCount64` à zéro ; la session suivante est alors vue dans le même
/// démarrage et un arrêt normal peut afficher le bandeau (faux positif accepté, texte neutre :
/// « PR Radar a été fermé de façon inattendue »). Un redémarrage remet bien le compteur à zéro.
#[cfg(target_os = "macos")]
fn boot_ms() -> Option<i64> {
    let mut tv = libc::timeval {
        tv_sec: 0,
        tv_usec: 0,
    };
    let mut size = std::mem::size_of::<libc::timeval>();
    let mut mib = [libc::CTL_KERN, libc::KERN_BOOTTIME];
    // SAFETY: `mib` et `tv` sont valides le temps de l'appel, `size` est la taille de `tv`.
    let r = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            2,
            (&raw mut tv).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    (r == 0 && tv.tv_sec > 0).then(|| tv.tv_sec * 1_000 + i64::from(tv.tv_usec) / 1_000)
}

#[cfg(target_os = "linux")]
fn boot_ms() -> Option<i64> {
    parse_btime(&fs::read_to_string("/proc/stat").ok()?)
}

/// Ligne `btime <secondes>` de /proc/stat.
#[cfg(any(target_os = "linux", test))]
fn parse_btime(stat: &str) -> Option<i64> {
    stat.lines()
        .find_map(|l| l.strip_prefix("btime "))
        .and_then(|v| v.trim().parse::<i64>().ok())
        .map(|s| s * 1_000)
}

#[cfg(windows)]
fn boot_ms() -> Option<i64> {
    // SAFETY: sans argument ni état partagé.
    let uptime = unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() };
    Some(now_ms() - i64::try_from(uptime).ok()?)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn boot_ms() -> Option<i64> {
    None
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
    Some(serde_json::from_str(&text).unwrap_or(Session::new(0)))
}

/// Marqueur resté d'un démarrage précédent du système, sans panic : arrêt ou fermeture de session
/// (l'app n'a pas reçu `RunEvent::Exit`), pas un plantage.
/// Comparaison avec le lancement de la session (et non deux heures de démarrage dérivées de l'horloge) :
/// un saut d'horloge entre deux lancements du même démarrage ne fait pas passer un plantage pour un arrêt,
/// sauf saut en avant plus grand que le temps écoulé entre le démarrage et ce lancement.
fn is_crash(prev: &Session, boot: Option<i64>) -> bool {
    match boot {
        _ if prev.panic.is_some() => true,
        // marqueur illisible : lancement inconnu
        _ if prev.started_at <= 0 => true,
        Some(b) => prev.started_at >= b - BOOT_TOLERANCE_MS,
        None => true,
    }
}

/// Lancement : session précédente si son marqueur est resté (et que c'est un plantage), puis marqueur
/// de cette session.
fn begin(data: &Path, now: i64, boot: Option<i64>) -> Option<Session> {
    let previous = read_marker(data).filter(|p| is_crash(p, boot));
    let _ = write_marker(data, &Session::new(now));
    previous
}

/// Fermeture propre : marqueur supprimé.
fn end(data: &Path) {
    let _ = fs::remove_file(data.join(MARKER));
}

/// Panic noté dans le marqueur (recréé s'il manque : le prochain lancement le verra).
fn note_panic(data: &Path, started_at: i64, panic: Panic) {
    let mut s = read_marker(data).unwrap_or(Session::new(started_at));
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
    let boot = boot_ms();
    let _ = STARTED_AT.set(now);
    *LOG_DIR.lock().unwrap_or_else(|e| e.into_inner()) = load_log_dir(&data);
    *PREVIOUS.lock().unwrap_or_else(|e| e.into_inner()) = begin(&data, now, boot);
    let _ = PATHS.set(Paths { data, default_log });
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        on_panic(info);
        default_hook(info);
    }));
}

/// Fermeture propre (`RunEvent::Exit` : Quitter, désinstallation, redémarrage après mise à jour, SIGTERM
/// et SIGHUP sur unix). Restent sans fermeture propre : kill -9, fin de tâche (Windows), coupure de
/// courant ; sous Windows, une fermeture de session sans redémarrage. Faux positif restant : l'arrêt avec
/// démarrage rapide de Windows (voir `boot_ms`).
pub fn shutdown() {
    if let Some(p) = PATHS.get() {
        end(&p.data);
    }
}

/// Unix : SIGTERM (arrêt du système, fermeture de session, `kill`) et SIGHUP (terminal fermé) quittent
/// l'app comme « Quitter » : `RunEvent::Exit`, donc marqueur supprimé, serveur web et MCP arrêtés.
#[cfg(unix)]
pub fn quit_on_signals(app: &AppHandle) {
    use tokio::signal::unix::{SignalKind, signal};
    for kind in [SignalKind::terminate(), SignalKind::hangup()] {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let Ok(mut s) = signal(kind) else { return };
            if s.recv().await.is_some() {
                app.exit(0);
                // boucle d'événements bloquée : sortie forcée après un délai, marqueur supprimé quand même
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_millis(SIGNAL_EXIT_GRACE_MS));
                    shutdown();
                    std::process::exit(0);
                });
            }
        });
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
            &Session::new(STARTED_AT.get().copied().unwrap_or(0)),
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

    /// démarrage du système ; sessions lancées après
    const BOOT: Option<i64> = Some(1_000_000);
    const T1: i64 = 2_000_000;
    const T2: i64 = 3_000_000;

    #[test]
    fn clean_exit_leaves_no_previous_session() {
        let data = tmp("clean");
        assert_eq!(begin(&data, T1, BOOT), None);
        end(&data);
        assert_eq!(begin(&data, T2, BOOT), None);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn unclean_exit_is_reported_once() {
        let data = tmp("unclean");
        begin(&data, T1, BOOT);
        assert_eq!(begin(&data, T2, BOOT), Some(Session::new(T1)));
        end(&data);
        assert_eq!(begin(&data, T2 + 1, BOOT), None);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn marker_from_previous_boot_is_a_system_shutdown() {
        let data = tmp("reboot");
        begin(&data, T1, BOOT);
        // système redémarré après ce lancement
        assert_eq!(begin(&data, T2 + 10_000_000, Some(T2)), None);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn session_started_before_current_boot_is_not_a_crash() {
        let boot = 10_000_000;
        assert!(!is_crash(
            &Session::new(boot - BOOT_TOLERANCE_MS - 1),
            Some(boot)
        ));
        // marge : heure de démarrage dérivée de l'horloge
        assert!(is_crash(
            &Session::new(boot - BOOT_TOLERANCE_MS),
            Some(boot)
        ));
        assert!(is_crash(&Session::new(boot + 1), Some(boot)));
    }

    #[test]
    fn clock_step_within_the_same_boot_keeps_the_crash() {
        let real_boot = 10_000_000;
        let prev = Session::new(real_boot + 3_600_000);
        // horloge reculée de 10 min : heure de démarrage calculée plus tôt
        assert!(is_crash(&prev, Some(real_boot - 600_000)));
        // horloge avancée de 10 min (moins que l'heure écoulée entre le démarrage et le lancement)
        assert!(is_crash(&prev, Some(real_boot + 600_000)));
    }

    #[test]
    fn unknown_boot_or_start_counts_as_a_crash() {
        assert!(is_crash(&Session::new(T1), None));
        assert!(is_crash(&Session::new(0), BOOT));
    }

    #[test]
    fn panic_counts_as_a_crash_even_after_a_reboot() {
        let mut panicked = Session::new(T1);
        panicked.panic = Some(panic_at(5));
        assert!(is_crash(&panicked, Some(T2 * 10)));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn boot_time_is_in_the_past() {
        let boot = boot_ms().unwrap();
        assert!(boot > 0 && boot < now_ms());
    }

    #[test]
    fn btime_parsing() {
        assert_eq!(
            parse_btime("cpu  1 2 3\nbtime 1793491200\nprocesses 9\n"),
            Some(1_793_491_200_000)
        );
        assert_eq!(parse_btime("cpu 1\n"), None);
    }

    #[test]
    fn panic_is_kept_for_next_launch() {
        let data = tmp("panic");
        begin(&data, T1, BOOT);
        note_panic(&data, T1, panic_at(5));
        let mut expected = Session::new(T1);
        expected.panic = Some(panic_at(5));
        // même après un redémarrage du système : un panic reste un plantage
        assert_eq!(begin(&data, T2 * 10, Some(T2 * 5)), Some(expected));
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn panic_recreates_missing_marker() {
        let data = tmp("recreate");
        note_panic(&data, T1, panic_at(5));
        assert_eq!(begin(&data, T2, BOOT).unwrap().started_at, T1);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn unreadable_marker_counts_as_unclean() {
        let data = tmp("corrupt");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join(MARKER), "{\"startedAt\":").unwrap();
        assert_eq!(begin(&data, T2, BOOT), Some(Session::new(0)));
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn status_is_read_once() {
        *PREVIOUS.lock().unwrap() = Some(Session::new(1));
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
