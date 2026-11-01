import { DAY_MS, LOG_STRING_MAX_CHARS } from "./constants.ts"
import type { Settings } from "./settings.ts"
import type { LogEntry, LogLevel, Pr } from "./types.ts"

/** Niveaux du journal, du moins au plus grave (mêmes valeurs que src-tauri/src/log.rs). */
export const LOG_LEVELS: LogLevel[] = ["info", "warn", "error"]

const REDACTED = "[redacted]"

/** Jetons reconnus dans le texte : GitHub (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_), Slack (xox?-). */
const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
]
/** `Authorization: …` (avec ou sans schéma), puis `Bearer …` / `token …` seuls */
const AUTH_HEADER =
  /(\bauthorization["']?\s*[:=]\s*["']?)(?:(?:bearer|token|basic)\s+)?[^\s"',;}]+/gi
const AUTH_SCHEME = /(\b(?:bearer|token)\s+)[A-Za-z0-9._~+/=-]{8,}/gi
/** clés dont la valeur n'est jamais écrite */
const SECRET_KEY =
  /^(authorization|token|access_token|refresh_token|password|secret)$/i

const redactText = (s: string) => {
  let out = s
  for (const p of TOKEN_PATTERNS) out = out.replace(p, REDACTED)
  out = out
    .replace(AUTH_HEADER, `$1${REDACTED}`)
    .replace(AUTH_SCHEME, `$1${REDACTED}`)
  return out.length > LOG_STRING_MAX_CHARS
    ? `${out.slice(0, LOG_STRING_MAX_CHARS)}…`
    : out
}

/**
 * Copie expurgée d'une donnée à journaliser : jetons et en-têtes `Authorization` masqués dans les
 * chaînes, valeur des clés secrètes remplacée, chaînes longues tronquées, erreurs réduites à leur message.
 */
export function redact(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return redactText(v)
  if (v instanceof Error) return redactText(v.message)
  if (v === null || typeof v !== "object") return v
  // structure trop profonde (ou cyclique) : pas écrite
  if (depth > 5) return REDACTED
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1))
  return Object.fromEntries(
    Object.entries(v).map(([k, x]) => [
      k,
      SECRET_KEY.test(k) ? REDACTED : redact(x, depth + 1),
    ]),
  )
}

/** Jours gardés selon le réglage de conservation. */
export const retentionDays = (
  s: Pick<Settings, "logRetention" | "logRetentionDays">,
) =>
  s.logRetention === "24h"
    ? 1
    : s.logRetention === "7d"
      ? 7
      : s.logRetentionDays

/** Horodatage (ms) avant lequel les entrées sont purgées. */
export const retentionCutoff = (
  s: Pick<Settings, "logRetention" | "logRetentionDays">,
  now: number,
) => now - retentionDays(s) * DAY_MS

/** Numéro de la PR d'un nœud GraphQL (PR ou fil de review) parmi les PR chargées. */
export const prNumberOf = (
  prs: Pick<Pr, "id" | "number" | "threads">[],
  id: string,
) => prs.find((p) => p.id === id || p.threads.some((t) => t.id === id))?.number

/** Entrées renvoyées par `log_read` : celles mal formées sont ignorées. */
export const parseEntries = (raw: unknown): LogEntry[] =>
  Array.isArray(raw)
    ? raw.filter(
        (e): e is LogEntry =>
          typeof e === "object" &&
          e !== null &&
          Number.isFinite((e as LogEntry).ts) &&
          LOG_LEVELS.includes((e as LogEntry).level) &&
          typeof (e as LogEntry).event === "string",
      )
    : []

/** Entrées en JSONL (copie, comme le fichier du journal). */
export const toJsonl = (entries: LogEntry[]) =>
  entries.map((e) => JSON.stringify(e)).join("\n")
