import { getVersion } from "@tauri-apps/api/app"

import {
  LOG_BATCH_MAX,
  LOG_BUFFER_MAX,
  LOG_FLUSH_MS,
  LOG_PURGE_INTERVAL_MS,
} from "./constants.ts"
import { parseEntries, redact, retentionCutoff } from "./log-data.ts"
import { invoke, isWeb } from "./platform.ts"
import { osName } from "./report.ts"
import { getLogSettings } from "./log-settings.ts"
import type { LogDir, LogEntry, LogLevel } from "./types.ts"

/**
 * Journal d'activité local (src-tauri/src/log.rs) : entrées expurgées, gardées en mémoire puis écrites par
 * lots (une commande par lot). Au mieux : jamais d'exception vers l'appelant, une écriture ratée est perdue.
 * Rien n'est envoyé ailleurs. Version web (onglet du navigateur) : aucune entrée, les commandes `log_*`
 * ne sont pas ouvertes au navigateur.
 */

let buffer: LogEntry[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let started = false

/** dossier des réglages, null = celui par défaut ; relu à chaque commande : un changement vaut tout de suite */
const dir = () => getLogSettings().dir

/** Écrit le lot en attente ; résolu une fois écrit (ou perdu). */
function flush(): Promise<void> {
  clearTimeout(timer)
  timer = undefined
  if (!buffer.length) return Promise.resolve()
  const entries = buffer.splice(0, LOG_BATCH_MAX)
  if (buffer.length) timer = setTimeout(flush, 0)
  return invoke("log_append", { dir: dir(), entries }).then(
    () => {},
    () => {},
  )
}

/** Ajoute une entrée au journal (si activé). `data` : identifiants, compteurs, codes d'erreur ; jamais de texte saisi ou lu. */
export function log(level: LogLevel, event: string, data?: unknown) {
  try {
    if (isWeb || !getLogSettings().enabled) return
    buffer.push({
      ts: Date.now(),
      level,
      event,
      ...(data !== undefined && { data: redact(data) }),
    })
    if (buffer.length > LOG_BUFFER_MAX) buffer = buffer.slice(-LOG_BUFFER_MAX)
    if (buffer.length >= LOG_BATCH_MAX) void flush()
    else timer ??= setTimeout(flush, LOG_FLUSH_MS)
  } catch {
    // journal au mieux : l'appelant continue
  }
}

/** Purge selon la conservation réglée (au lancement, périodiquement, après un changement de réglage). */
export const purgeLog = () =>
  invoke<number>("log_purge", {
    dir: dir(),
    cutoffMs: retentionCutoff(getLogSettings(), Date.now()),
  })

/** Au lancement de l'app de bureau : entrée de démarrage, purge maintenant puis toutes les heures. */
export function startLog() {
  if (isWeb || started) return
  started = true
  void getVersion()
    .catch(() => null)
    .then((version) =>
      log("info", "app.start", { version, os: osName(navigator.userAgent) }),
    )
  const purge = () => {
    if (getLogSettings().enabled) purgeLog().catch(() => {})
  }
  purge()
  setInterval(purge, LOG_PURGE_INTERVAL_MS)
  // fenêtre rechargée ou app quittée : le lot en attente part tout de suite
  window.addEventListener("pagehide", () => void flush())
}

/** Dossier effectif d'un dossier choisi (null = par défaut) ; rejet si inutilisable. */
export const resolveLogDir = (d: string | null) =>
  invoke<LogDir>("log_dir", { dir: d })

/** Dernières entrées (la plus récente d'abord), au moins du niveau donné. Lot en attente écrit avant. */
export async function readLog(limit: number, level: LogLevel | null) {
  await flush()
  return parseEntries(
    await invoke<unknown>("log_read", { dir: dir(), limit, level }),
  )
}

/** Sélecteur de dossier du système : dossier choisi, null si annulé. */
export const pickLogDir = () => invoke<string | null>("log_pick_dir")

/** Ouvre le dossier du journal dans le Finder / l'Explorateur. */
export const revealLogDir = () => invoke<void>("log_reveal", { dir: dir() })

/** Enregistre tout le journal dans un fichier choisi : son chemin, null si annulé. */
export async function exportLog() {
  await flush()
  const day = new Date().toISOString().slice(0, 10)
  return invoke<string | null>("log_export", {
    dir: dir(),
    fileName: `pr-radar-log-${day}.jsonl`,
  })
}
