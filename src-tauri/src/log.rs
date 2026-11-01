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
/// place gardée en fin de fichier pour l'entrée `log.full`
const FULL_RESERVE_BYTES: u64 = 1024;
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

/// Fichier du journal ouvert sans suivre de lien symbolique (un lien posé à sa place est refusé).
fn open_log(path: &Path, o: &mut OpenOptions) -> std::io::Result<fs::File> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(std::io::Error::other(format!(
            "symlink refused: {}",
            path.display()
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // O_NOFOLLOW : aussi refusé si le lien apparaît entre la vérification et l'ouverture
        o.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    o.open(path)
}

fn open_append(path: &Path) -> std::io::Result<fs::File> {
    open_log(path, OpenOptions::new().create(true).append(true))
}

/// Résultat d'un ajout : entrées écrites, et ignorées parce que le fichier de leur jour est plein.
#[derive(Serialize, Debug, PartialEq, Default)]
pub struct Appended {
    pub written: usize,
    pub dropped: usize,
}

/// Ajoute les entrées valides au fichier de leur jour. Fichier plein (`MAX_FILE_BYTES - FULL_RESERVE_BYTES`) :
/// les entrées suivantes du jour sont ignorées et une entrée `log.full` (une seule par jour) le signale.
pub fn append(dir: &Path, entries: &[Entry]) -> Result<Appended, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let limit = MAX_FILE_BYTES - FULL_RESERVE_BYTES;
    let mut out = Appended::default();
    let mut by_file: Vec<(String, Vec<String>)> = Vec::new();
    for e in entries.iter().take(MAX_BATCH).filter(|e| e.valid()) {
        let line = serde_json::to_string(e).map_err(|e| e.to_string())? + "\n";
        let name = file_name(e.ts);
        match by_file.iter_mut().find(|(n, _)| *n == name) {
            Some((_, lines)) => lines.push(line),
            None => by_file.push((name, vec![line])),
        }
    }
    for (name, lines) in by_file {
        let path = dir.join(&name);
        let mut size = fs::symlink_metadata(&path).map(|m| m.len()).unwrap_or(0);
        // `log.full` déjà écrite : le jour est clos, plus rien n'y est ajouté (ni une seconde `log.full`)
        let closed = size > 0 && has_full_marker(&path);
        let mut buf = String::new();
        let mut dropped = 0;
        for line in lines {
            if !closed && size + line.len() as u64 <= limit {
                size += line.len() as u64;
                buf += &line;
                out.written += 1;
            } else {
                dropped += 1;
            }
        }
        if dropped > 0 && !closed {
            let day_end = (file_day(&name).unwrap_or(0) + 1) * DAY_MS - 1;
            let full = Entry {
                ts: day_end.min(now_ms()),
                level: "warn".into(),
                event: "log.full".into(),
                data: serde_json::json!({ "maxBytes": MAX_FILE_BYTES, "dropped": dropped }),
            };
            let line = serde_json::to_string(&full).map_err(|e| e.to_string())? + "\n";
            // fichier étranger déjà au plafond : pas d'entrée de plus
            if size + line.len() as u64 <= MAX_FILE_BYTES {
                buf += &line;
            }
        }
        out.dropped += dropped;
        if buf.is_empty() {
            continue;
        }
        let mut f = open_append(&path).map_err(|e| e.to_string())?;
        f.write_all(buf.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// La fin du fichier contient l'entrée `log.full` (elle est toujours la dernière ligne du jour).
fn has_full_marker(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = open_log(path, OpenOptions::new().read(true)) else {
        return false;
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut tail = Vec::new();
    f.seek(SeekFrom::Start(len.saturating_sub(FULL_RESERVE_BYTES)))
        .and_then(|_| f.read_to_end(&mut tail))
        .is_ok()
        && String::from_utf8_lossy(&tail)
            .lines()
            .last()
            .is_some_and(|l| l.contains(r#""event":"log.full""#))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn rank(level: &str) -> usize {
    LEVELS.iter().position(|l| *l == level).unwrap_or(0)
}

/// Dernières entrées (la plus récente d'abord), au moins du niveau `min_level` ; lignes illisibles ignorées.
/// Fichiers lus du plus récent au plus ancien, arrêt dès `limit` atteint.
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
                replace(&path, kept.as_bytes()).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(removed)
}

/// Remplace le fichier d'un coup : fichier temporaire à côté (créé, jamais suivi), puis renommage.
/// Un arrêt en cours de route laisse l'ancien fichier entier.
fn replace(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("log");
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    // reste d'un arrêt précédent (fichier ou lien) : retiré, jamais suivi
    let _ = fs::remove_file(&tmp);
    let written = open_log(&tmp, OpenOptions::new().write(true).create_new(true))
        .and_then(|mut f| f.write_all(bytes).and_then(|()| f.sync_all()));
    match written {
        Ok(()) => fs::rename(&tmp, path),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Copie tout le journal du dossier dans `out`, du plus ancien au plus récent (export), fichier par fichier.
fn export_to(dir: &Path, out: &Path) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut f = open_log(
        out,
        OpenOptions::new().create(true).write(true).truncate(true),
    )
    .map_err(|e| e.to_string())?;
    for (_, path) in log_files(dir)? {
        if let Ok(mut src) = fs::File::open(&path) {
            std::io::copy(&mut src, &mut f).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/* ---------- Commandes : hors du fil principal (fichiers lus ou réécrits en entier) ---------- */

/// Exécute `f` sur un fil bloquant du runtime : l'interface ne gèle pas pendant les accès disque.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

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
pub async fn log_dir(app: AppHandle, dir: Option<String>) -> Result<LogDir, String> {
    blocking(move || {
        let s = |p: &Path| p.to_string_lossy().into_owned();
        Ok(LogDir {
            dir: s(&resolve(&app, dir.as_deref())?),
            default_dir: s(&default_dir(&app)?),
        })
    })
    .await
}

#[tauri::command]
pub async fn log_append(
    app: AppHandle,
    dir: Option<String>,
    entries: Vec<Entry>,
) -> Result<Appended, String> {
    blocking(move || append(&resolve(&app, dir.as_deref())?, &entries)).await
}

#[tauri::command]
pub async fn log_read(
    app: AppHandle,
    dir: Option<String>,
    limit: usize,
    level: Option<String>,
) -> Result<Vec<Value>, String> {
    blocking(move || read(&resolve(&app, dir.as_deref())?, limit, level.as_deref())).await
}

#[tauri::command]
pub async fn log_purge(
    app: AppHandle,
    dir: Option<String>,
    cutoff_ms: i64,
) -> Result<usize, String> {
    blocking(move || purge(&resolve(&app, dir.as_deref())?, cutoff_ms)).await
}

/// Ouvre le dossier dans le Finder / l'Explorateur.
#[tauri::command]
pub async fn log_reveal(app: AppHandle, dir: Option<String>) -> Result<(), String> {
    blocking(move || {
        let p = resolve(&app, dir.as_deref())?;
        app.opener()
            .open_path(p.to_string_lossy(), None::<&str>)
            .map_err(|e| e.to_string())
    })
    .await
}

/// Sélecteur de dossier du système ; renvoie le dossier choisi (vérifié), None si annulé.
/// Dialogue ouvert depuis Rust : aucune permission `dialog:*` donnée à la fenêtre.
#[tauri::command]
pub async fn log_pick_dir(app: AppHandle) -> Result<Option<String>, String> {
    blocking(move || {
        let mut d = app.dialog().file();
        if let Ok(start) = default_dir(&app) {
            d = d.set_directory(start);
        }
        let Some(p) = d.blocking_pick_folder() else {
            return Ok(None);
        };
        let p = p.into_path().map_err(|e| e.to_string())?;
        ensure_dir(&p)?;
        Ok(Some(p.to_string_lossy().into_owned()))
    })
    .await
}

/// Enregistre tout le journal dans un fichier choisi ; renvoie son chemin, None si annulé.
#[tauri::command]
pub async fn log_export(
    app: AppHandle,
    dir: Option<String>,
    file_name: String,
) -> Result<Option<String>, String> {
    blocking(move || {
        let dir = resolve(&app, dir.as_deref())?;
        let Some(p) = app
            .dialog()
            .file()
            .set_file_name(file_name)
            .add_filter("JSON Lines", &["jsonl"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let p = p.into_path().map_err(|e| e.to_string())?;
        export_to(&dir, &p)?;
        Ok(Some(p.to_string_lossy().into_owned()))
    })
    .await
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
        assert_eq!(
            n,
            Appended {
                written: 3,
                dropped: 0
            }
        );
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
    fn full_day_drops_entries_and_says_so_once() {
        let dir = tmp("cap");
        ensure_dir(&dir).unwrap();
        let path = dir.join(file_name(NOV_1));
        let limit = (MAX_FILE_BYTES - FULL_RESERVE_BYTES) as usize;
        fs::write(&path, "x".repeat(limit - 10) + "\n").unwrap();
        let two = [entry(NOV_1, "info"), entry(NOV_1 + 1, "info")];
        assert_eq!(
            append(&dir, &two).unwrap(),
            Appended {
                written: 0,
                dropped: 2
            }
        );
        assert_eq!(
            append(&dir, &two).unwrap(),
            Appended {
                written: 0,
                dropped: 2
            }
        );
        let text = fs::read_to_string(&path).unwrap();
        assert_eq!(text.matches("log.full").count(), 1);
        assert!(text.lines().last().unwrap().contains(r#""dropped":2"#));
        assert!(fs::metadata(&path).unwrap().len() <= MAX_FILE_BYTES);
        // les autres jours ne sont pas touchés
        assert_eq!(
            append(&dir, &[entry(NOV_1 + DAY_MS, "info")]).unwrap(),
            Appended {
                written: 1,
                dropped: 0
            }
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_log_file_is_refused() {
        let dir = tmp("link");
        ensure_dir(&dir).unwrap();
        let target = dir.join("target.txt");
        fs::write(&target, "secret\n").unwrap();
        let link = dir.join(file_name(NOV_1));
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(append(&dir, &[entry(NOV_1, "info")]).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "secret\n");
        // lecture et purge ignorent le lien (ce n'est pas un fichier du journal)
        assert!(read(&dir, 10, None).unwrap().is_empty());
        assert_eq!(purge(&dir, NOV_1 + 2 * DAY_MS).unwrap(), 0);
        assert!(target.exists());
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
        assert!(!dir.join(".pr-radar-2026-10-31.jsonl.tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.join("pr-radar-2026-10-31.jsonl"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
