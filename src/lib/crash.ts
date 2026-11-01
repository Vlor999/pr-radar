import { useSyncExternalStore } from "react"

import { allAccounts } from "./auth.ts"
import { splitKey } from "./accounts.ts"
import { CRASH_LOG_READ_LIMIT } from "./constants.ts"
import {
  admitError,
  crashEntries,
  crashOf,
  crashReport,
  errorInfo,
  newErrorGate,
  type Crash,
  type CrashReport,
  type Known,
  type PreviousSession,
} from "./crash-data.ts"
import type { Lang } from "./i18n.ts"
import { log, readLog } from "./log.ts"
import { invoke, isWeb } from "./platform.ts"
import { getData, getRepos } from "./store.ts"

/**
 * Plantages : session précédente mal terminée (src-tauri/src/crash.rs), erreurs de la webview
 * journalisées. Rien n'est envoyé : le rapport s'ouvre dans le navigateur, l'utilisateur le publie.
 */

type CrashStatus = { previous: PreviousSession | null; startedAt: number }

/** plantage de la session précédente, null : aucun ou bandeau fermé */
let previous: Crash | null = null
/** lancement de cette session (pour le rapport d'une erreur de l'interface) */
let startedAt = Date.now()
const listeners = new Set<() => void>()

/** Au lancement de l'app de bureau : session précédente lue une fois. */
export async function loadCrashStatus() {
  if (isWeb) return
  try {
    const s = await invoke<CrashStatus>("crash_status")
    if (s.startedAt) startedAt = s.startedAt
    previous = s.previous ? crashOf(s.previous, s.startedAt) : null
    listeners.forEach((l) => l())
  } catch {
    // au mieux : pas de bandeau
  }
}

export const usePreviousCrash = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => previous,
  )

export function dismissCrash() {
  previous = null
  listeners.forEach((l) => l())
}

/** Plantage de l'interface (ErrorBoundary) dans cette session. */
export const webviewCrash = (e: unknown): Crash => ({
  kind: "webview",
  ts: Date.now(),
  startedAt,
  until: Infinity,
  ...errorInfo(e),
})

/**
 * Windows : l'installeur de mise à jour quitte l'app sans fermeture propre (`std::process::exit`).
 * `true` avant l'installation, `false` si elle échoue (la session continue).
 */
export const markCleanExit = (clean: boolean) =>
  isWeb
    ? Promise.resolve()
    : invoke<void>("session_clean", { clean }).catch(() => {})

/* ---------- Erreurs de la webview ---------- */

const gate = newErrorGate()

function logError(event: string, e: unknown) {
  try {
    const info = errorInfo(e)
    if (!admitError(gate, info.message, Date.now())) return
    log("error", event, info)
  } catch {
    // jamais d'erreur depuis le gestionnaire d'erreurs : pas de boucle
  }
}

/** Erreurs non rattrapées et promesses rejetées sans `catch` : journalisées (dédoublonnées, limitées). */
export function watchErrors() {
  if (isWeb) return
  window.addEventListener("error", (e) =>
    logError("webview.error", e.error ?? e.message),
  )
  window.addEventListener("unhandledrejection", (e) =>
    logError("webview.rejection", e.reason),
  )
}

/** Plantage de l'interface rattrapé par l'ErrorBoundary. */
export const logRenderCrash = (e: unknown, componentStack?: string | null) =>
  log("error", "webview.crash", {
    ...errorInfo(e),
    ...(componentStack && { componentStack }),
  })

/* ---------- Rapport ---------- */

/** Repos et comptes que l'app connaît : remplacés dans le rapport public. */
function known(): Known {
  const repos = new Set<string>()
  for (const k of getRepos() ?? []) repos.add(splitKey(k).name)
  for (const p of getData().prs) repos.add(p.repo)
  return { repos: [...repos], accounts: allAccounts() }
}

/** Rapport du plantage : journal lu (avertissements et erreurs), expurgé, anonymisé. */
export async function buildCrashReport(
  crash: Crash,
  lang: Lang,
): Promise<CrashReport> {
  const entries = isWeb
    ? []
    : await readLog(CRASH_LOG_READ_LIMIT, "warn").catch(() => [])
  return crashReport(crash, crashEntries(entries, crash), known(), lang)
}
