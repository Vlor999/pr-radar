//! Journal d'activité local : JSONL, un fichier par jour UTC (`pr-radar-YYYY-MM-DD.jsonl`).
//! Rien n'est envoyé : l'interface écrit des lots d'entrées déjà expurgées (src/lib/log.ts).
//! Le dossier est un réglage de l'interface, passé à chaque commande (`dir`, None = dossier par défaut
//! `app_log_dir`) : un changement de dossier vaut tout de suite, sans état à tenir ici.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const PREFIX: &str = "pr-radar-";
const EXT: &str = ".jsonl";
/// fichier du jour plein : les entrées suivantes de ce jour sont ignorées
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// lot reçu en une fois (l'interface en envoie au plus 100)
const MAX_BATCH: usize = 1_000;
/// entrées lues au plus par `log_read`
const MAX_READ: usize = 2_000;
const MAX_EVENT_CHARS: usize = 64;
const DAY_MS: i64 = 86_400_000;
/// niveaux, du moins au plus grave
const LEVELS: [&str; 3] = ["info", "warn", "error"];

/// écritures, purges et lectures l'une après l'autre (commandes, futur code Rust)
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct Entry {
    /// horodatage (ms depuis l'époque Unix)
    pub ts: i64,
    pub level: String,
    pub event: String,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub data: Value,
}

impl Entry {
    fn valid(&self) -> bool {
        self.ts >= 0
            && LEVELS.contains(&self.level.as_str())
            && !self.event.is_empty()
            && self.event.len() <= MAX_EVENT_CHARS
            && self
                .event
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
    }
}

/* ---------- Dates : jours depuis 1970-01-01 <-> (année, mois, jour), calendrier grégorien ---------- */

/// Algorithme de H. Hinnant (`civil_from_days`).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// Inverse de `civil` (`days_from_civil`).
fn days(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Fichier du jour (UTC) de l'horodatage.
fn file_name(ts: i64) -> String {
    let (y, m, d) = civil(ts.div_euclid(DAY_MS));
    format!("{PREFIX}{y:04}-{m:02}-{d:02}{EXT}")
}

/// Jour (depuis l'époque) d'un nom de fichier du journal, None pour tout autre fichier.
fn file_day(name: &str) -> Option<i64> {
    let date = name.strip_prefix(PREFIX)?.strip_suffix(EXT)?;
    let b = date.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<u32> {
        let s = &date[r];
        s.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| s.parse().ok())?
    };
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let day = days(i64::from(y), m, d);
    // 2026-02-31 : refusé (ne retombe pas sur la même date)
    (civil(day) == (i64::from(y), m, d)).then_some(day)
}

/* ---------- Dossier ---------- */

/// Dossier choisi : chemin absolu, sans `..`, pas un fichier existant.
fn check_dir(p: &Path) -> Result<(), String> {
    if !p.is_absolute() || p.components().any(|c| c == Component::ParentDir) {
        return Err(format!("not an absolute path: {}", p.display()));
    }
    if p.exists() && !p.is_dir() {
        return Err(format!("not a directory: {}", p.display()));
    }
    Ok(())
}

/// Crée le dossier s'il manque (0o700 sur unix : les dossiers créés seulement, pas un dossier existant).
fn ensure_dir(p: &Path) -> Result<(), String> {
    check_dir(p)?;
    let mut b = fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(p).map_err(|e| format!("{}: {e}", p.display()))
}

fn default_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_log_dir().map_err(|e| e.to_string())
}

/// Dossier effectif : celui des réglages, sinon celui par défaut ; vérifié et créé.
pub fn resolve(app: &AppHandle, dir: Option<&str>) -> Result<PathBuf, String> {
    let p = match dir.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => default_dir(app)?,
    };
    ensure_dir(&p)?;
    Ok(p)
}

/// Fichiers du journal du dossier, du plus ancien au plus récent.
fn log_files(dir: &Path) -> Result<Vec<(i64, PathBuf)>, String> {
    let mut files: Vec<(i64, PathBuf)> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| Some((file_day(e.file_name().to_str()?)?, e.path())))
        .collect();
    files.sort();
    Ok(files)
}

/* ---------- Écriture, lecture, purge ---------- */

fn open_append(path: &Path) -> std::io::Result<fs::File> {
    let mut o = OpenOptions::new();
    o.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o.open(path)
}

/// Ajoute les entrées valides au fichier de leur jour ; renvoie le nombre écrit (fichier plein : ignorées).
pub fn append(dir: &Path, entries: &[Entry]) -> Result<usize, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut written = 0;
    let mut by_file: Vec<(String, String)> = Vec::new();
    for e in entries.iter().take(MAX_BATCH).filter(|e| e.valid()) {
        let line = serde_json::to_string(e).map_err(|e| e.to_string())? + "\n";
        let name = file_name(e.ts);
        match by_file.iter_mut().find(|(n, _)| *n == name) {
            Some((_, buf)) => buf.push_str(&line),
            None => by_file.push((name, line)),
        }
    }
    for (name, buf) in by_file {
        let path = dir.join(name);
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size + buf.len() as u64 > MAX_FILE_BYTES {
            continue;
        }
        let mut f = open_append(&path).map_err(|e| e.to_string())?;
        f.write_all(buf.as_bytes()).map_err(|e| e.to_string())?;
        written += buf.lines().count();
    }
    Ok(written)
}

fn rank(level: &str) -> usize {
    LEVELS.iter().position(|l| *l == level).unwrap_or(0)
}

/// Dernières entrées (la plus récente d'abord), au moins du niveau `min_level` ; lignes illisibles ignorées.
pub fn read(dir: &Path, limit: usize, min_level: Option<&str>) -> Result<Vec<Value>, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let min = min_level.map_or(0, rank);
    let limit = limit.min(MAX_READ);
    let mut out = Vec::new();
    for (_, path) in log_files(dir)?.into_iter().rev() {
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        for line in text.lines().rev() {
            if out.len() >= limit {
                return Ok(out);
            }
            if let Ok(v) = serde_json::from_str::<Value>(line)
                && v.get("level")
                    .and_then(Value::as_str)
                    .is_some_and(|l| rank(l) >= min)
            {
                out.push(v);
            }
        }
    }
    Ok(out)
}

/// Supprime ce qui précède `cutoff_ms` : fichiers des jours finis avant, entrées plus anciennes du jour
/// à cheval. Renvoie le nombre de fichiers supprimés.
pub fn purge(dir: &Path, cutoff_ms: i64) -> Result<usize, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut removed = 0;
    for (day, path) in log_files(dir)? {
        if (day + 1) * DAY_MS <= cutoff_ms {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            removed += 1;
        } else if day * DAY_MS < cutoff_ms {
            let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let kept: String = text
                .lines()
                .filter(|l| {
                    serde_json::from_str::<Value>(l)
                        .ok()
                        .and_then(|v| v.get("ts")?.as_i64())
                        .is_some_and(|ts| ts >= cutoff_ms)
                })
                .map(|l| format!("{l}\n"))
                .collect();
            if kept.len() != text.len() {
                // réécrit en place : les droits du fichier (0o600) sont gardés
                fs::write(&path, kept).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(removed)
}

/// Tout le journal du dossier, du plus ancien au plus récent (export).
fn concat(dir: &Path) -> Result<String, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = String::new();
    for (_, path) in log_files(dir)? {
        out += &fs::read_to_string(&path).unwrap_or_default();
    }
    Ok(out)
}

/* ---------- Commandes ---------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogDir {
    /// dossier effectif (créé)
    dir: String,
    /// dossier par défaut de l'app
    default_dir: String,
}

/// Dossier effectif et dossier par défaut ; erreur si `dir` n'est pas utilisable.
#[tauri::command]
pub fn log_dir(app: AppHandle, dir: Option<String>) -> Result<LogDir, String> {
    let s = |p: &Path| p.to_string_lossy().into_owned();
    Ok(LogDir {
        dir: s(&resolve(&app, dir.as_deref())?),
        default_dir: s(&default_dir(&app)?),
    })
}

#[tauri::command]
pub fn log_append(
    app: AppHandle,
    dir: Option<String>,
    entries: Vec<Entry>,
) -> Result<usize, String> {
    append(&resolve(&app, dir.as_deref())?, &entries)
}

#[tauri::command]
pub fn log_read(
    app: AppHandle,
    dir: Option<String>,
    limit: usize,
    level: Option<String>,
) -> Result<Vec<Value>, String> {
    read(&resolve(&app, dir.as_deref())?, limit, level.as_deref())
}

#[tauri::command]
pub fn log_purge(app: AppHandle, dir: Option<String>, cutoff_ms: i64) -> Result<usize, String> {
    purge(&resolve(&app, dir.as_deref())?, cutoff_ms)
}

/// Ouvre le dossier dans le Finder / l'Explorateur.
#[tauri::command]
pub fn log_reveal(app: AppHandle, dir: Option<String>) -> Result<(), String> {
    let p = resolve(&app, dir.as_deref())?;
    app.opener()
        .open_path(p.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Sélecteur de dossier du système ; renvoie le dossier choisi (vérifié), None si annulé.
/// Dialogue ouvert depuis Rust : aucune permission `dialog:*` donnée à la fenêtre.
#[tauri::command]
pub async fn log_pick_dir(app: AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let start = default_dir(&app).ok();
        let mut d = app.dialog().file();
        if let Some(s) = start {
            d = d.set_directory(s);
        }
        d.blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(p) = picked else { return Ok(None) };
    let p = p.into_path().map_err(|e| e.to_string())?;
    ensure_dir(&p)?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

/// Enregistre tout le journal dans un fichier choisi ; renvoie son chemin, None si annulé.
#[tauri::command]
pub async fn log_export(
    app: AppHandle,
    dir: Option<String>,
    file_name: String,
) -> Result<Option<String>, String> {
    let text = concat(&resolve(&app, dir.as_deref())?)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(file_name)
            .add_filter("JSON Lines", &["jsonl"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(p) = picked else { return Ok(None) };
    let p = p.into_path().map_err(|e| e.to_string())?;
    let mut o = OpenOptions::new();
    o.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o.open(&p)
        .and_then(|mut f| f.write_all(text.as_bytes()))
        .map_err(|e| e.to_string())?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// dossier temporaire propre à chaque test
    fn tmp(name: &str) -> PathBuf {
        let p =
            std::env::temp_dir().join(format!("pr-radar-log-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        p
    }

    fn entry(ts: i64, level: &str) -> Entry {
        Entry {
            ts,
            level: level.into(),
            event: "refresh".into(),
            data: Value::Null,
        }
    }

    /// 2026-11-01T00:00:00Z
    const NOV_1: i64 = 1_793_491_200_000;

    #[test]
    fn file_naming() {
        assert_eq!(file_name(0), "pr-radar-1970-01-01.jsonl");
        assert_eq!(file_name(NOV_1), "pr-radar-2026-11-01.jsonl");
        assert_eq!(file_name(NOV_1 - 1), "pr-radar-2026-10-31.jsonl");
        assert_eq!(file_name(951_782_400_000), "pr-radar-2000-02-29.jsonl");
        assert_eq!(file_day("pr-radar-2026-11-01.jsonl"), Some(NOV_1 / DAY_MS));
        for bad in [
            "pr-radar-2026-02-31.jsonl",
            "pr-radar-2026-11-01.json",
            "other-2026-11-01.jsonl",
            "pr-radar-2026-1-01.jsonl",
            "pr-radar-+026-11-01.jsonl",
            "pr-radar-2026-11-01.jsonl.bak",
        ] {
            assert_eq!(file_day(bad), None, "{bad}");
        }
    }

    #[test]
    fn dir_validation() {
        let root = tmp("dir");
        assert!(check_dir(Path::new("relative/logs")).is_err());
        assert!(check_dir(&root.join("a/../b")).is_err());
        let nested = root.join("a/b");
        ensure_dir(&nested).unwrap();
        assert!(nested.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&nested).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        let file = root.join("file");
        fs::write(&file, "x").unwrap();
        assert!(ensure_dir(&file).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_then_read() {
        let dir = tmp("rw");
        ensure_dir(&dir).unwrap();
        let mut bad = entry(NOV_1, "debug");
        bad.event = "x".into();
        let n = append(
            &dir,
            &[
                entry(NOV_1 - 10, "info"),
                entry(NOV_1 + 10, "error"),
                bad,
                entry(NOV_1 + 20, "warn"),
            ],
        )
        .unwrap();
        assert_eq!(n, 3);
        assert!(dir.join("pr-radar-2026-10-31.jsonl").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.join("pr-radar-2026-11-01.jsonl"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let ts = |v: &Vec<Value>| {
            v.iter()
                .map(|e| e["ts"].as_i64().unwrap())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            ts(&read(&dir, 10, None).unwrap()),
            [NOV_1 + 20, NOV_1 + 10, NOV_1 - 10]
        );
        assert_eq!(
            ts(&read(&dir, 10, Some("warn")).unwrap()),
            [NOV_1 + 20, NOV_1 + 10]
        );
        assert_eq!(ts(&read(&dir, 1, None).unwrap()), [NOV_1 + 20]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn full_file_is_left_alone() {
        let dir = tmp("cap");
        ensure_dir(&dir).unwrap();
        let path = dir.join(file_name(NOV_1));
        fs::write(&path, "x".repeat(MAX_FILE_BYTES as usize)).unwrap();
        assert_eq!(append(&dir, &[entry(NOV_1, "info")]).unwrap(), 0);
        assert_eq!(fs::metadata(&path).unwrap().len(), MAX_FILE_BYTES);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn purge_by_cutoff() {
        let dir = tmp("purge");
        ensure_dir(&dir).unwrap();
        let hour = 3_600_000;
        append(
            &dir,
            &[
                entry(NOV_1 - 2 * DAY_MS, "info"),
                entry(NOV_1 - 3 * hour, "info"),
                entry(NOV_1 - hour, "info"),
                entry(NOV_1 + hour, "info"),
            ],
        )
        .unwrap();
        fs::write(dir.join("notes.txt"), "keep").unwrap();
        // limite à 22 h la veille : jour d'avant-hier supprimé, veille réduite à 23 h
        assert_eq!(purge(&dir, NOV_1 - 2 * hour).unwrap(), 1);
        let ts: Vec<i64> = read(&dir, 10, None)
            .unwrap()
            .iter()
            .map(|e| e["ts"].as_i64().unwrap())
            .collect();
        assert_eq!(ts, [NOV_1 + hour, NOV_1 - hour]);
        assert!(dir.join("notes.txt").exists());
        assert!(!dir.join("pr-radar-2026-10-30.jsonl").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
