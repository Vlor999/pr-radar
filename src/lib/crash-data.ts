import {
  CRASH_ISSUE_LABEL,
  CRASH_ISSUE_TEMPLATE,
  CRASH_LOG_LINES,
  WEBVIEW_ERROR_DEDUPE_MS,
  WEBVIEW_ERROR_MAX_PER_MIN,
} from "./constants.ts"
import { strings, type Lang } from "./i18n.ts"
import { redact, toJsonl } from "./log-data.ts"
import { issueFormUrl, type ReportContext } from "./report.ts"
import type { LogEntry } from "./types.ts"

// Rapport de plantage : logique pure (testée). L'issue est publique : rien d'identifiant n'y va,
// jetons expurgés, repos, comptes et hôtes remplacés par `repo-1`, `account-1`, `host-1`…

const S = strings(
  {
    kinds: {
      panic: "panic Rust",
      webview: "erreur de l'interface",
      unclean: "fermeture inattendue",
    },
    title: (kind: string) => `Plantage : ${kind}`,
    kind: "Type",
    time: "Heure",
    timeUnknown: (start: string) =>
      `inconnue (session lancée le ${start}, fin non enregistrée)`,
    message: "Message",
    location: "Emplacement",
    stack: "Pile",
    what: "<!-- Que faisiez-vous juste avant ? -->",
    desktop: "app de bureau",
    web: "version web",
    unknown: "inconnu",
  },
  {
    kinds: {
      panic: "Rust panic",
      webview: "interface error",
      unclean: "unexpected exit",
    },
    title: (kind: string) => `Crash: ${kind}`,
    kind: "Kind",
    time: "Time",
    timeUnknown: (start: string) =>
      `unknown (session started ${start}, end not recorded)`,
    message: "Message",
    location: "Location",
    stack: "Stack",
    what: "<!-- What were you doing just before? -->",
    desktop: "desktop app",
    web: "web version",
    unknown: "unknown",
  },
)

/** Session précédente mal terminée, telle que `crash_status` la renvoie (src-tauri/src/crash.rs). */
export type PreviousSession = {
  /** 0 : marqueur illisible */
  startedAt: number
  panic?: { ts: number; message: string; location: string | null } | null
}

export type CrashKind = "panic" | "webview" | "unclean"

export type Crash = {
  kind: CrashKind
  /** heure du plantage ; null : inconnue (fermeture inattendue) */
  ts: number | null
  /** lancement de la session plantée (0 : inconnu) */
  startedAt: number
  /** fin de la fenêtre du journal lue (lancement suivant ; Infinity : session en cours) */
  until: number
  message?: string
  location?: string
  stack?: string
}

/** Plantage d'une session précédente : panic noté par le hook, sinon fermeture inattendue. */
export const crashOf = (prev: PreviousSession, startedAt: number): Crash =>
  prev.panic
    ? {
        kind: "panic",
        ts: prev.panic.ts,
        startedAt: prev.startedAt,
        until: startedAt,
        message: prev.panic.message,
        location: prev.panic.location ?? undefined,
      }
    : {
        kind: "unclean",
        ts: null,
        startedAt: prev.startedAt,
        until: startedAt,
      }

/** Avertissements et erreurs de la session plantée (`newest` : la plus récente d'abord), dans l'ordre. */
export const crashEntries = (
  newest: LogEntry[],
  crash: Pick<Crash, "startedAt" | "until">,
  n = CRASH_LOG_LINES,
) =>
  newest
    .filter(
      (e) =>
        e.level !== "info" && e.ts >= crash.startedAt && e.ts < crash.until,
    )
    .slice(0, n)
    .reverse()

/* ---------- Anonymisation ---------- */

/** Ce que l'app sait identifiant : repos suivis ou chargés (`owner/name`), comptes connectés. */
export type Known = {
  repos: string[]
  accounts: { id: string; host: string; login?: string }[]
}

const GITHUB_HOST = "github.com"
/** `owner/name` dans une adresse GitHub ou d'API (`/repos/owner/name`) */
const REPO_IN_URL =
  /(?:\/repos\/|github\.com\/(?!repos\/))([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g
/** valeur trop courte : remplacée partout, elle abîmerait le texte (et n'identifie rien seule) */
const MIN_SECRET_CHARS = 3

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Chaînes trouvées sous les clés `key` (récursif). */
function valuesOf(v: unknown, key: string, out: string[], depth = 0) {
  if (depth > 6 || v === null || typeof v !== "object") return
  for (const [k, x] of Object.entries(v)) {
    if (k === key && typeof x === "string") out.push(x)
    else valuesOf(x, key, out, depth + 1)
  }
}

function stringsOf(v: unknown, out: string[], depth = 0) {
  if (typeof v === "string") out.push(v)
  else if (depth <= 6 && v !== null && typeof v === "object")
    for (const x of Object.values(v)) stringsOf(x, out, depth + 1)
}

/**
 * Remplaçant de texte : chaque repo, compte, login et hôte connu (ou vu dans le journal) devient
 * `repo-N`, `account-N`, `host-N`, numérotés dans l'ordre d'apparition dans le texte.
 */
export function anonymizer(
  known: Known,
  seen: unknown[],
): (s: string) => string {
  const texts: string[] = []
  stringsOf(seen, texts)
  const repos = [...known.repos]
  const accounts: string[] = known.accounts
    .filter((a) => a.id !== "github")
    .map((a) => a.id)
  valuesOf(seen, "repo", repos)
  valuesOf(seen, "account", accounts)
  for (const t of texts)
    for (const m of t.matchAll(REPO_IN_URL)) repos.push(m[1])
  const hosts = known.accounts.map((a) => a.host)
  const logins = known.accounts.flatMap((a) => (a.login ? [a.login] : []))
  for (const id of accounts) {
    const at = id.lastIndexOf("@")
    if (at > 0) {
      logins.push(id.slice(0, at))
      hosts.push(id.slice(at + 1))
    }
  }
  // repos sans le compte (`<compte>:owner/name`) et sans `.git`
  const clean = (r: string) =>
    r.slice(r.lastIndexOf(":") + 1).replace(/\.git$/, "")
  const groups: [string, string[]][] = [
    ["repo", repos.map(clean)],
    ["account", [...accounts.filter((a) => a !== "github"), ...logins]],
    ["host", hosts.filter((h) => h !== GITHUB_HOST)],
  ]
  const joined = texts.join("\n").toLowerCase()
  const firstSeen = (v: string) => {
    const i = joined.indexOf(v.toLowerCase())
    return i < 0 ? Infinity : i
  }
  const map = new Map<string, string>()
  for (const [prefix, values] of groups) {
    const unique = [
      ...new Set(
        values
          .map((v) => v.trim())
          .filter((v) => v.length >= MIN_SECRET_CHARS)
          .map((v) => v.toLowerCase()),
      ),
    ].filter((v) => !map.has(v))
    unique
      .sort((a, b) => firstSeen(a) - firstSeen(b))
      .forEach((v, i) => map.set(v, `${prefix}-${i + 1}`))
  }
  if (!map.size) return (s) => s
  // plus longues d'abord : `acme/web-app` avant `acme/web`, `login@hôte` avant `login`
  const keys = [...map.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    keys
      .map((k) => `(?<![A-Za-z0-9_.-])${escape(k)}(?![A-Za-z0-9_-])`)
      .join("|"),
    "gi",
  )
  return (s) => s.replace(pattern, (m) => map.get(m.toLowerCase()) ?? m)
}

/** Copie d'une donnée où chaque chaîne (et clé) est passée au remplaçant. */
const mapStrings = (
  v: unknown,
  f: (s: string) => string,
  depth = 0,
): unknown => {
  if (typeof v === "string") return f(v)
  if (depth > 6 || v === null || typeof v !== "object") return v
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f, depth + 1))
  return Object.fromEntries(
    Object.entries(v).map(([k, x]) => [f(k), mapStrings(x, f, depth + 1)]),
  )
}

/* ---------- Rapport ---------- */

export type CrashReport = {
  title: string
  /** résumé (type, heure, message), modifiable */
  description: string
  /** lignes du journal (JSONL), modifiables */
  logs: string
}

const iso = (ts: number) => new Date(ts).toISOString()

/** Rapport expurgé et anonymisé : résumé du plantage, lignes du journal autour. */
export function crashReport(
  crash: Crash,
  entries: LogEntry[],
  known: Known,
  lang: Lang,
): CrashReport {
  const t = S[lang]
  const clean = redact({
    message: crash.message,
    location: crash.location,
    stack: crash.stack,
    entries,
  }) as {
    message?: string
    location?: string
    stack?: string
    entries: LogEntry[]
  }
  const anon = anonymizer(known, [clean])
  const a = mapStrings(clean, anon) as typeof clean
  const kind = t.kinds[crash.kind]
  const when =
    crash.ts !== null
      ? iso(crash.ts)
      : t.timeUnknown(crash.startedAt ? iso(crash.startedAt) : t.unknown)
  const description = [
    `- ${t.kind}: ${kind}`,
    `- ${t.time}: ${when}`,
    ...(a.message
      ? [`- ${t.message}: \`${a.message.replace(/`/g, "'")}\``]
      : []),
    ...(a.location ? [`- ${t.location}: \`${a.location}\``] : []),
    ...(a.stack ? ["", `${t.stack}:`, "```", a.stack, "```"] : []),
    "",
    t.what,
  ].join("\n")
  return { title: t.title(kind), description, logs: toJsonl(a.entries) }
}

/** Champs `version` et `os` du formulaire (mêmes ids que crash.yml). */
const contextFields = (ctx: ReportContext, lang: Lang): [string, string][] => [
  ["version", ctx.version ?? S[lang].unknown],
  [
    "os",
    `${ctx.os ?? S[lang].unknown} · ${ctx.web ? S[lang].web : S[lang].desktop}`,
  ],
]

/** Issue préremplie (formulaire crash.yml, label `crash`) : journal raccourci d'abord si trop long. */
export const crashIssueUrl = (
  report: CrashReport,
  ctx: ReportContext,
  lang: Lang,
  maxLength?: number,
) =>
  issueFormUrl(
    {
      title: report.title,
      fields: [
        ["description", report.description],
        ...contextFields(ctx, lang),
        ["logs", report.logs],
      ],
      lines: "logs",
      cut: "description",
    },
    lang,
    { template: CRASH_ISSUE_TEMPLATE, labels: [CRASH_ISSUE_LABEL] },
    maxLength,
  )

/* ---------- Erreurs de la webview : pas de boucle ni de rafale ---------- */

export type ErrorGate = { seen: Map<string, number>; window: number[] }

export const newErrorGate = (): ErrorGate => ({ seen: new Map(), window: [] })

/** Erreur à journaliser ? Même message ignoré pendant un délai, et au plus N par minute. */
export function admitError(gate: ErrorGate, key: string, now: number): boolean {
  const last = gate.seen.get(key)
  if (last !== undefined && now - last < WEBVIEW_ERROR_DEDUPE_MS) return false
  gate.window = gate.window.filter((t) => now - t < 60_000)
  if (gate.window.length >= WEBVIEW_ERROR_MAX_PER_MIN) return false
  gate.window.push(now)
  gate.seen.set(key, now)
  // messages anciens oubliés : la table ne grossit pas sans fin
  for (const [k, t] of gate.seen)
    if (now - t >= WEBVIEW_ERROR_DEDUPE_MS) gate.seen.delete(k)
  return true
}

/** Message et pile d'une erreur quelconque (`throw "x"`, rejet sans Error…). */
export function errorInfo(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error)
    return { message: e.message || e.name, stack: e.stack || undefined }
  if (typeof e === "string") return { message: e }
  try {
    return { message: JSON.stringify(e) ?? String(e) }
  } catch {
    return { message: String(e) }
  }
}
