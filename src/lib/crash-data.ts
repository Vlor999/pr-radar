import { DEFAULT_ID, GITHUB } from "./accounts.ts"
import {
  CRASH_EMAIL,
  CRASH_HOME_DIRS,
  CRASH_ISSUE_LABEL,
  CRASH_ISSUE_TEMPLATE,
  CRASH_LOG_LINES,
  CRASH_MIN_SECRET_CHARS,
  CRASH_OWNER_IN_URL,
  CRASH_REPO_IN_URL,
  WEBVIEW_ERROR_DEDUPE_MS,
  WEBVIEW_ERROR_MAX_PER_MIN,
  WEBVIEW_ERROR_WINDOW_MS,
} from "./constants.ts"
import { strings, type Lang } from "./i18n.ts"
import { redact, toJsonl } from "./log-data.ts"
import { issueFormUrl, type ReportContext } from "./report.ts"
import type { LogEntry } from "./types.ts"

// Rapport de plantage : logique pure (testée). L'issue est publique : rien d'identifiant n'y va,
// jetons expurgés, repos, comptes, propriétaires et hôtes remplacés par `repo-1`, `account-1`…,
// dossiers personnels et e-mails masqués.

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
    minimal:
      "_Message et journal laissés de côté : le rapport complet n'a pas pu être préparé._",
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
    minimal:
      "_Message and log left out: the full report could not be prepared._",
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

/** Dossier personnel → `~`, adresses e-mail masquées. */
export const scrub = (s: string) =>
  CRASH_HOME_DIRS.reduce((t, p) => t.replace(p, "~"), s).replace(
    CRASH_EMAIL,
    "[email]",
  )

/**
 * Remplaçant de texte : chaque repo (`owner/name`, et son nom seul), compte, login, propriétaire et
 * hôte connu (ou vu dans le journal) devient `repo-N`, `account-N`, `owner-N`, `host-N`, numérotés
 * dans l'ordre d'apparition dans le texte ; puis dossiers personnels et e-mails masqués (`scrub`).
 */
export function anonymizer(
  known: Known,
  seen: unknown[],
): (s: string) => string {
  const texts: string[] = []
  stringsOf(seen, texts)
  const repos = [...known.repos]
  const accounts: string[] = known.accounts.map((a) => a.id)
  valuesOf(seen, "repo", repos)
  valuesOf(seen, "account", accounts)
  const hosts = known.accounts.map((a) => a.host)
  const logins = known.accounts.flatMap((a) => (a.login ? [a.login] : []))
  for (const id of accounts) {
    const at = id.lastIndexOf("@")
    if (at > 0) {
      logins.push(id.slice(0, at))
      hosts.push(id.slice(at + 1))
    }
  }
  const ghe = [...new Set(hosts.filter((h) => h !== GITHUB))]
  // adresses web d'un hôte GitHub Enterprise : `https://<hôte>/owner/name` (hors API)
  const gheRepo = ghe.length
    ? new RegExp(
        `(?:${ghe.map(escape).join("|")})/(?!(?:api|repos|orgs|users)/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)`,
        "gi",
      )
    : null
  const owners: string[] = []
  for (const t of texts) {
    for (const m of t.matchAll(CRASH_REPO_IN_URL)) repos.push(m[1])
    if (gheRepo) for (const m of t.matchAll(gheRepo)) repos.push(m[1])
    for (const m of t.matchAll(CRASH_OWNER_IN_URL)) owners.push(m[1])
  }
  // repos sans le compte (`<compte>:owner/name`) et sans `.git`
  const full = repos
    .map((r) => r.slice(r.lastIndexOf(":") + 1).replace(/\.git$/, ""))
    .filter((r) => r.includes("/"))
  for (const r of full) owners.push(r.slice(0, r.indexOf("/")))
  const groups: [string, string[]][] = [
    ["repo", full],
    ["account", [...accounts.filter((a) => a !== DEFAULT_ID), ...logins]],
    ["owner", owners],
    ["host", ghe],
  ]
  const joined = texts.join("\n").toLowerCase()
  const firstSeen = (v: string) => {
    const i = joined.indexOf(v)
    return i < 0 ? Infinity : i
  }
  const map = new Map<string, string>()
  for (const [prefix, values] of groups) {
    const unique = [
      ...new Set(
        values
          .map((v) => v.trim().toLowerCase())
          .filter((v) => v.length >= CRASH_MIN_SECRET_CHARS),
      ),
    ].filter((v) => !map.has(v))
    unique
      .sort((a, b) => firstSeen(a) - firstSeen(b))
      .forEach((v, i) => map.set(v, `${prefix}-${i + 1}`))
  }
  // nom seul d'un repo : même remplaçant que `owner/name`
  for (const r of full) {
    const name = r.slice(r.indexOf("/") + 1).toLowerCase()
    const placeholder = map.get(r.toLowerCase())
    if (placeholder && name.length >= CRASH_MIN_SECRET_CHARS && !map.has(name))
      map.set(name, placeholder)
  }
  if (!map.size) return scrub
  // plus longues d'abord : `acme/web-app` avant `acme/web`, `login@hôte` avant `login`.
  // Pas de lookbehind (WebKit avant Safari 16.4) : le caractère qui précède est capturé et remis.
  const keys = [...map.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_.-])(${keys.map(escape).join("|")})(?![A-Za-z0-9_-])`,
    "gi",
  )
  return (s) =>
    scrub(
      s.replace(
        pattern,
        (_, before: string, k: string) =>
          before + (map.get(k.toLowerCase()) ?? k),
      ),
    )
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
  const description = [
    ...summary(crash, lang),
    ...(a.message
      ? [`- ${t.message}: \`${a.message.replace(/`/g, "'")}\``]
      : []),
    ...(a.location ? [`- ${t.location}: \`${a.location}\``] : []),
    ...(a.stack ? ["", `${t.stack}:`, "```", a.stack, "```"] : []),
    "",
    t.what,
  ].join("\n")
  return {
    title: t.title(t.kinds[crash.kind]),
    description,
    logs: toJsonl(a.entries),
  }
}

/** Type et heure du plantage. */
function summary(crash: Crash, lang: Lang) {
  const t = S[lang]
  const when =
    crash.ts !== null
      ? iso(crash.ts)
      : t.timeUnknown(crash.startedAt ? iso(crash.startedAt) : t.unknown)
  return [`- ${t.kind}: ${t.kinds[crash.kind]}`, `- ${t.time}: ${when}`]
}

/**
 * Rapport réduit quand le rapport complet n'a pas pu être construit : type et heure seulement, aucun
 * message ni ligne du journal (rien qui puisse identifier).
 */
export const minimalReport = (crash: Crash, lang: Lang): CrashReport => ({
  title: S[lang].title(S[lang].kinds[crash.kind]),
  description: [
    ...summary(crash, lang),
    "",
    S[lang].minimal,
    "",
    S[lang].what,
  ].join("\n"),
  logs: "",
})

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
  gate.window = gate.window.filter((t) => now - t < WEBVIEW_ERROR_WINDOW_MS)
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
