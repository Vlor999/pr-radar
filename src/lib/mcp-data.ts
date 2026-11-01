// Serveur MCP local : logique pure (testée). Le câblage Tauri est dans `mcp.ts`.
import { formatDuration, jobDurationMs } from "./checks.ts"
import { ATTENTION_AGE_HOURS_MAX, ATTENTION_URGENT } from "./constants.ts"
import { HOUR_MS, MINUTE_MS } from "./quiet.ts"
import type {
  CiView,
  McpCall,
  MergedPr,
  Note,
  Pr,
  PrNode,
  RepoTree,
  ReviewPr,
  SlackMention,
  Thread,
} from "./types.ts"

/** historique local des appels MCP : les plus récents seulement */
export const MCP_HISTORY_MAX = 50
/** `Node.TEXT_NODE` du DOM */
const TEXT_NODE = 3
const BLOCKS = new Set([
  "P",
  "DIV",
  "UL",
  "OL",
  "PRE",
  "BLOCKQUOTE",
  "TABLE",
  "TR",
  "DETAILS",
  "SUMMARY",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
])

export type McpTool =
  "get_prs" | "get_pr" | "get_attention" | "get_checks" | "get_merged"

export type SlackStatus = "connected" | "expired" | "disabled"

/** Fraîcheur des données, jointe à chaque réponse : l'agent juge s'il peut s'y fier. */
export type McpContext = {
  fetchedAt: string | null
  loading: boolean
  error: string | null
  slack: {
    status: SlackStatus
    /** PR encore dans la file de lecture des mentions */
    queue: number
    error: string | null
  }
}

/** Mentions connues d'une PR (déjà filtrées par les conversations choisies) ; `null` : pas cherchées. */
export type MentionsOf = (
  url: string,
) => { at: number; list: SlackMention[] } | null

/** Réponse renvoyée au shim : `text` (JSON sérialisé, `content[0].text`) ou `error`. */
export type McpReply = { text: string } | { error: string }

/* ---------- Slack ---------- */

export const slackStatus = (s: {
  connected: boolean
  expired: boolean
  /** au moins une conversation choisie */
  active: boolean
}): SlackStatus =>
  !s.connected || !s.active ? "disabled" : s.expired ? "expired" : "connected"

/* ---------- HTML → texte ---------- */

/** Sous-ensemble du DOM lu par `htmlToText` (un `DOMParser` dans la webview, un faux en test). */
export type HtmlNode = {
  nodeType: number
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<HtmlNode>
  getAttribute?: (name: string) => string | null
}

const nodeText = (n: HtmlNode): string => {
  if (n.nodeType === TEXT_NODE) return n.textContent ?? ""
  const name = n.nodeName.toUpperCase()
  if (name === "BR") return "\n"
  if (name === "IMG") {
    const alt = n.getAttribute?.("alt")
    return alt ? `[${alt}]` : ""
  }
  const inner = Array.from(n.childNodes, nodeText).join("")
  if (name === "A") {
    const href = n.getAttribute?.("href")
    const text = inner.trim()
    const mention = /\b(user|team)-mention\b/.test(
      n.getAttribute?.("class") ?? "",
    )
    if (!href || href.startsWith("#") || mention) return inner
    return !text || text === href ? href : `${text} (${href})`
  }
  if (name === "LI") return `\n- ${inner.trim()}\n`
  if (BLOCKS.has(name)) return `\n${inner}\n`
  return inner
}

/** Texte d'un `bodyHTML` GitHub : paragraphes et listes en lignes, liens en `texte (url)`. */
export const htmlToText = (root: HtmlNode) =>
  nodeText(root)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

/* ---------- Réponses des outils ---------- */

/** Parent de chaque PR dans l'arbre (PR sur laquelle elle est stackée), par URL. */
export const parentsOf = (trees: RepoTree[]) => {
  const out = new Map<string, number | null>()
  const walk = (n: PrNode) => {
    out.set(n.url, n.parent)
    n.children.forEach(walk)
  }
  trees.forEach((t) => t.roots.forEach((r) => r.children.forEach(walk)))
  return out
}

/** Défaut d'un champ JSON : `null`, `false`, `0`, `[]` ou `{}` (absent de la réponse). */
const isDefault = (v: unknown) =>
  v == null ||
  v === false ||
  v === 0 ||
  (Array.isArray(v)
    ? v.length === 0
    : typeof v === "object" && !Object.keys(v).length)

/** Retire récursivement les champs à leur valeur par défaut : moins de tokens pour l'agent, absent = défaut. Les éléments des tableaux sont gardés. */
export const omitDefaults = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(omitDefaults)
  if (!v || typeof v !== "object") return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    const c = omitDefaults(x)
    if (!isDefault(c)) out[k] = c
  }
  return out
}

/** `CHANGES_REQUESTED` → `changesRequested` */
const camel = (state: string) =>
  state.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase())

/** Reviewers en listes de logins : une par état de review, puis les demandes (personnes, équipes). */
const reviewersOf = (p: Pr) => {
  const byState: Record<string, string[]> = {}
  for (const r of p.reviews) (byState[camel(r.state)] ??= []).push(r.who)
  return {
    ...byState,
    requested: p.requested.filter((r) => !r.team).map((r) => r.who),
    requestedTeams: p.requested.filter((r) => r.team).map((r) => r.who),
  }
}

const compactPr = (
  p: Pr,
  parents: Map<string, number | null>,
  mentionsOf: MentionsOf,
) => {
  const slack = mentionsOf(p.url)
  return {
    repo: p.repo,
    number: p.number,
    title: p.title,
    url: p.url,
    draft: p.draft,
    ci: p.ci,
    decision: p.decision,
    conflicting: p.conflicting,
    head: p.head,
    base: p.base,
    additions: p.additions,
    deletions: p.deletions,
    files: p.files,
    unresolved: p.unresolved,
    comments: p.comments,
    updated: p.updated,
    reviewers: reviewersOf(p),
    // numéro de la PR sur laquelle elle est stackée
    parent: parents.get(p.url),
    stack: p.stack,
    // PR d'un autre (assignée, mentionné, impliqué) ; absent : une de mes PR
    involved: p.involved,
    // absent : pas cherchées ; `{checkedAt}` seul : cherchées, aucune mention
    slack: slack && {
      checkedAt: new Date(slack.at).toISOString(),
      mentions: slack.list,
    },
  }
}

/* ---------- Filtres de `get_prs` ---------- */

export const PRS_SCOPES = ["mine", "involved", "reviews", "all"] as const
export type PrsScope = (typeof PRS_SCOPES)[number]

/** Arguments de `get_prs` validés ; aucun argument : tout, sans limite. */
export type PrsFilters = {
  /** sous-chaîne de `owner/name`, casse ignorée */
  repo?: string
  scope: PrsScope
  needsAction: boolean
  /** maximum par liste (`prs`, `reviews`) */
  limit?: number
}

export const NO_FILTERS: PrsFilters = { scope: "all", needsAction: false }

/** Ce que j'ai à faire sur une PR. */
export type ActionReason =
  | "ciFailing"
  | "changesRequested"
  | "conflicting"
  | "unresolvedThreads"
  | "behindBase"
  | "reviewRequested"
  | "inUnresolvedThread"

/**
 * Raisons d'agir sur un élément, vide : rien à faire.
 * - ma PR : CI en échec, changements demandés, conflit, fils non résolus, branche à mettre à jour ;
 * - PR d'un autre (`involved`) : review demandée à moi nommément, fil non résolu où j'ai écrit ;
 * - file « À reviewer » : toujours une review demandée.
 * `me` : mes logins (un par compte), casse ignorée.
 */
export const actionReasons = (
  item: { pr: Pr } | { review: ReviewPr },
  me: string[],
): ActionReason[] => {
  if ("review" in item) return ["reviewRequested"]
  const p = item.pr
  const logins = new Set(me.map((l) => l.toLowerCase()))
  const isMe = (who: string) => logins.has(who.toLowerCase())
  if (p.involved) {
    const out: ActionReason[] = []
    if (p.requested.some((r) => !r.team && isMe(r.who)))
      out.push("reviewRequested")
    if (p.threads.some((t) => t.comments.some((c) => isMe(c.author))))
      out.push("inUnresolvedThread")
    return out
  }
  const checks: [boolean, ActionReason][] = [
    [p.ci === "FAILURE" || p.ci === "ERROR", "ciFailing"],
    [p.decision === "CHANGES_REQUESTED", "changesRequested"],
    [p.conflicting, "conflicting"],
    [p.unresolved > 0, "unresolvedThreads"],
    [p.canUpdateBranch, "behindBase"],
  ]
  return checks.filter(([on]) => on).map(([, r]) => r)
}

const PRS_ARGS = new Set(["repo", "scope", "needs_action", "limit"])

/** Arguments de `get_prs` (déjà validés par le shim, revus ici par défense, mêmes règles) ; `null` vaut absent, `limit` : entier exact ≥ 1 (`1.0` accepté, `1e20` refusé). */
export const parsePrsArgs = (
  args: unknown,
): { ok: true; filters: PrsFilters } | { ok: false; error: string } => {
  if (args == null) return { ok: true, filters: NO_FILTERS }
  if (typeof args !== "object" || Array.isArray(args))
    return { ok: false, error: "get_prs: arguments must be an object" }
  const a = args as Record<string, unknown>
  const unknown = Object.keys(a).find((k) => !PRS_ARGS.has(k))
  if (unknown)
    return { ok: false, error: `get_prs: unknown argument \`${unknown}\`` }
  const { repo, scope, needs_action, limit } = a
  if (repo != null && typeof repo !== "string")
    return { ok: false, error: "get_prs: `repo` must be a string" }
  if (scope != null && !PRS_SCOPES.includes(scope as PrsScope))
    return {
      ok: false,
      error: `get_prs: \`scope\` must be one of ${PRS_SCOPES.join(", ")}`,
    }
  if (needs_action != null && typeof needs_action !== "boolean")
    return { ok: false, error: "get_prs: `needs_action` must be a boolean" }
  if (
    limit != null &&
    !(typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 1)
  )
    return { ok: false, error: "get_prs: `limit` must be an integer >= 1" }
  return {
    ok: true,
    filters: {
      ...(repo != null && { repo }),
      scope: (scope as PrsScope | null | undefined) ?? "all",
      needsAction: needs_action ?? false,
      ...(limit != null && { limit }),
    },
  }
}

/** Liste coupée à `limit` ; `cut` : éléments retirés. */
const capped = <T>(list: T[], limit?: number) =>
  limit === undefined
    ? { kept: list, cut: 0 }
    : { kept: list.slice(0, limit), cut: Math.max(0, list.length - limit) }

/** `get_prs` : mes PR ouvertes et celles des autres qui me concernent (avec mentions Slack) et l'onglet « À reviewer », filtrés. Valeurs par défaut omises. */
export const prsPayload = (
  ctx: McpContext,
  prs: Pr[],
  reviews: ReviewPr[],
  parents: Map<string, number | null>,
  mentionsOf: MentionsOf,
  filters: PrsFilters = NO_FILTERS,
  me: string[] = [],
) => {
  const { scope, needsAction, limit } = filters
  const needle = filters.repo?.toLowerCase() ?? ""
  const inRepo = (repo: string) => repo.toLowerCase().includes(needle)
  const all = scope === "all"
  const keptPrs = prs.filter(
    (p) =>
      (p.involved ? all || scope === "involved" : all || scope === "mine") &&
      inRepo(p.repo) &&
      (!needsAction || actionReasons({ pr: p }, me).length > 0),
  )
  const keptReviews = reviews.filter(
    (r) =>
      (all || scope === "reviews") &&
      inRepo(r.repo) &&
      (!needsAction || actionReasons({ review: r }, me).length > 0),
  )
  const outPrs = capped(keptPrs, limit)
  const outReviews = capped(keptReviews, limit)
  return omitDefaults({
    ...ctx,
    prs: outPrs.kept.map((p) => compactPr(p, parents, mentionsOf)),
    reviews: outReviews.kept,
    // éléments au-delà de `limit`, par liste
    truncated: { prs: outPrs.cut, reviews: outReviews.cut },
  }) as Record<string, unknown>
}

/* ---------- `get_attention` ---------- */

const ATTENTION_ARGS = new Set(["repo"])

/** Arguments de `get_attention` (déjà validés par le shim, revus ici par défense) ; `null` vaut absent. */
export const parseAttentionArgs = (
  args: unknown,
): { ok: true; repo?: string } | { ok: false; error: string } => {
  if (args == null) return { ok: true }
  if (typeof args !== "object" || Array.isArray(args))
    return { ok: false, error: "get_attention: arguments must be an object" }
  const a = args as Record<string, unknown>
  const unknown = Object.keys(a).find((k) => !ATTENTION_ARGS.has(k))
  if (unknown)
    return {
      ok: false,
      error: `get_attention: unknown argument \`${unknown}\``,
    }
  const { repo } = a
  if (repo != null && typeof repo !== "string")
    return { ok: false, error: "get_attention: `repo` must be a string" }
  return { ok: true, ...(repo != null && { repo }) }
}

/** Durée courte : `45m`, `5h`, `3d` (heures jusqu'à 48 h). */
export const ageLabel = (ms: number) => {
  const hours = Math.floor(ms / HOUR_MS)
  if (hours < 1) return `${Math.max(0, Math.floor(ms / MINUTE_MS))}m`
  return hours < ATTENTION_AGE_HOURS_MAX
    ? `${hours}h`
    : `${Math.floor(hours / 24)}d`
}

type AttentionItem = {
  url: string
  repo: string
  number: number
  title: string
  reasons: ActionReason[]
  /** depuis quand : demande de review (file « À reviewer »), sinon dernière mise à jour de la PR */
  since: string
}

/**
 * `get_attention` : une entrée par PR qui attend une action de ma part (raisons de `actionReasons`).
 * Une PR à la fois dans la file « À reviewer » et dans l'arbre : raisons réunies, date de la demande.
 * Tri : review demandée ou CI en échec d'abord, puis la plus ancienne ; à égalité, file « À reviewer »
 * puis arbre, dans leur ordre. Valeurs par défaut omises.
 */
export const attentionPayload = (
  ctx: McpContext,
  prs: Pr[],
  reviews: ReviewPr[],
  me: string[],
  now: number,
  repo?: string,
) => {
  const needle = repo?.toLowerCase() ?? ""
  const items = new Map<string, AttentionItem>()
  const add = (p: Pr | ReviewPr, reasons: ActionReason[], since: string) => {
    if (!reasons.length || !p.repo.toLowerCase().includes(needle)) return
    const key = normalizeUrl(p.url)
    const prev = items.get(key)
    if (prev) {
      prev.reasons = [...new Set([...prev.reasons, ...reasons])]
      // URL de l'arbre : canonique, celle que `get_pr` attend
      prev.url = p.url
    } else
      items.set(key, {
        url: p.url,
        repo: p.repo,
        number: p.number,
        title: p.title,
        reasons,
        since,
      })
  }
  // file « À reviewer » d'abord : sa date de demande l'emporte sur la mise à jour de la PR
  for (const r of reviews) add(r, actionReasons({ review: r }, me), r.since)
  for (const p of prs) add(p, actionReasons({ pr: p }, me), p.updated)
  const urgent = (i: AttentionItem) =>
    i.reasons.some((r) => ATTENTION_URGENT.includes(r)) ? 0 : 1
  const sorted = [...items.values()].sort(
    (a, b) =>
      urgent(a) - urgent(b) || Date.parse(a.since) - Date.parse(b.since),
  )
  return omitDefaults({
    fetchedAt: ctx.fetchedAt,
    loading: ctx.loading,
    error: ctx.error,
    items: sorted.map(({ since, ...i }) => ({
      ...i,
      age: ageLabel(now - Date.parse(since)),
    })),
  }) as Record<string, unknown>
}

/** URL de PR comparable : sans `#…`, `?…`, `/files`, `/commits`, `/` final, casse ignorée. */
export const normalizeUrl = (url: string) =>
  url
    .trim()
    .replace(/[#?].*$/, "")
    .replace(/\/(files|commits|checks)(\/.*)?$/, "")
    .replace(/\/+$/, "")
    .toLowerCase()

/** `get_pr` : une PR ouverte de l'arbre (à moi, ou d'un autre qui me concerne), fils non résolus et conversation en texte. Valeurs par défaut omises. */
export const prPayload = (
  ctx: McpContext,
  url: string,
  prs: Pr[],
  reviews: ReviewPr[],
  parents: Map<string, number | null>,
  mentionsOf: MentionsOf,
  toText: (html: string) => string,
): { ok: true; data: unknown } | { ok: false; error: string } => {
  const found = findTreePr("get_pr", url, prs, reviews)
  if (!found.ok) return found
  const pr = found.pr
  const comment = (c: Thread["comments"][number] | Note) => ({
    author: c.author,
    at: c.at,
    url: c.url,
    ...("state" in c && c.state && { state: c.state }),
    body: toText(c.body),
  })
  return {
    ok: true,
    data: omitDefaults({
      ...ctx,
      pr: {
        ...compactPr(pr, parents, mentionsOf),
        threads: pr.threads.map((t) => ({
          path: t.path,
          line: t.line,
          outdated: t.outdated,
          hunk: t.hunk,
          comments: t.comments.map(comment),
        })),
        conversation: pr.conversation.map(comment),
      },
    }),
  }
}

/* ---------- `get_checks` ---------- */

/** Arguments de `get_checks` (déjà validés par le shim, revus ici par défense, mêmes règles) : `url` seul, requis. */
export const parseChecksArgs = (
  args: unknown,
): { ok: true; url: string } | { ok: false; error: string } => {
  if (args != null && (typeof args !== "object" || Array.isArray(args)))
    return { ok: false, error: "get_checks: arguments must be an object" }
  const a = (args ?? {}) as Record<string, unknown>
  const unknown = Object.keys(a).find((k) => k !== "url")
  if (unknown)
    return { ok: false, error: `get_checks: unknown argument \`${unknown}\`` }
  if (typeof a.url !== "string")
    return { ok: false, error: "get_checks: missing `url` argument" }
  return { ok: true, url: a.url }
}

/** Vue CI en mémoire d'une PR de l'arbre (`cachedChecks`), `null` : pas lue ou plus fraîche. */
export type ChecksOf = (pr: Pr) => { value: CiView; at: number } | null

/** PR ouverte de l'arbre par URL ; sinon le message d'erreur pour l'agent (file « À reviewer » ou inconnue). */
const findTreePr = (
  tool: string,
  url: string,
  prs: Pr[],
  reviews: ReviewPr[],
): { ok: true; pr: Pr } | { ok: false; error: string } => {
  const key = normalizeUrl(url)
  const pr = prs.find((p) => normalizeUrl(p.url) === key)
  if (pr) return { ok: true, pr }
  return {
    ok: false,
    error: reviews.some((r) => normalizeUrl(r.url) === key)
      ? `PR waiting for your review: ${tool} only covers the open PRs of the "Open PRs" tree, yours and those where you are assigned, mentioned or involved (details of the review queue are not loaded). Use get_prs for its summary.`
      : `PR not found among the open PRs loaded in PR Radar (yours, or where you are assigned, mentioned or involved): ${url}`,
  }
}

/**
 * `get_checks` : jobs de la CI d'une PR de l'arbre, depuis le cache de la vue CI seulement (aucun appel).
 * Pas en cache : `notLoaded` dit d'ouvrir la vue CI dans PR Radar ou d'utiliser `gh pr checks`.
 * Durées comme la vue CI (`1m 31s`), lien seulement sur les jobs en échec. Valeurs par défaut omises.
 */
export const checksPayload = (
  ctx: McpContext,
  url: string,
  prs: Pr[],
  reviews: ReviewPr[],
  checksOf: ChecksOf,
  now: number,
): { ok: true; data: unknown } | { ok: false; error: string } => {
  const found = findTreePr("get_checks", url, prs, reviews)
  if (!found.ok) return found
  const p = found.pr
  const head = {
    fetchedAt: ctx.fetchedAt,
    loading: ctx.loading,
    error: ctx.error,
    pr: { url: p.url, repo: p.repo, number: p.number, sha: p.sha, ci: p.ci },
  }
  const hit = checksOf(p)
  if (!hit)
    return {
      ok: true,
      data: omitDefaults({
        ...head,
        notLoaded: `CI jobs of this PR are not loaded in PR Radar (read only when its CI view is opened, no network call from this tool). Open the CI pill of the PR in PR Radar, then retry, or run \`gh pr checks ${p.url}\`.`,
      }),
    }
  const counts: Record<string, number> = {}
  const workflows = hit.value.workflows.map((w) => ({
    name: w.name ?? "commit statuses",
    file: w.file,
    runId: w.runId,
    jobs: w.jobs.map((j) => {
      counts[j.state] = (counts[j.state] ?? 0) + 1
      const ms = jobDurationMs(j, now)
      return {
        name: j.name,
        state: j.state,
        duration: ms === null ? null : formatDuration(ms),
        url: j.state === "failure" ? j.url : null,
      }
    }),
    // jobs au-delà de la borne de la requête : non lus
    hiddenJobs: w.hiddenJobs,
  }))
  return {
    ok: true,
    data: omitDefaults({
      ...head,
      checkedAt: new Date(hit.at).toISOString(),
      counts,
      workflows,
      moreChecks: hit.value.moreChecks,
    }),
  }
}

/* ---------- `get_merged` ---------- */

const MERGED_ARGS = new Set(["from", "to", "repo"])
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/

/** Jour `YYYY-MM-DD` réel (mois 1-12, jour du mois, années bissextiles) ; mêmes règles que `is_day` du shim. */
export const isDay = (s: string) => {
  if (!DAY_FORMAT.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]
}

export type MergedFilters = { from?: string; to?: string; repo?: string }

/** Arguments de `get_merged` (déjà validés par le shim, revus ici par défense, mêmes règles) ; `null` vaut absent. */
export const parseMergedArgs = (
  args: unknown,
): { ok: true; filters: MergedFilters } | { ok: false; error: string } => {
  if (args == null) return { ok: true, filters: {} }
  if (typeof args !== "object" || Array.isArray(args))
    return { ok: false, error: "get_merged: arguments must be an object" }
  const a = args as Record<string, unknown>
  const unknown = Object.keys(a).find((k) => !MERGED_ARGS.has(k))
  if (unknown)
    return { ok: false, error: `get_merged: unknown argument \`${unknown}\`` }
  const { from, to, repo } = a
  if (repo != null && typeof repo !== "string")
    return { ok: false, error: "get_merged: `repo` must be a string" }
  for (const [k, v] of [
    ["from", from],
    ["to", to],
  ] as const)
    if (v != null && !(typeof v === "string" && isDay(v)))
      return {
        ok: false,
        error: `get_merged: \`${k}\` must be a date YYYY-MM-DD`,
      }
  if (typeof from === "string" && typeof to === "string" && from > to)
    return { ok: false, error: "get_merged: `from` must not be after `to`" }
  return {
    ok: true,
    filters: {
      ...(typeof from === "string" && { from }),
      ...(typeof to === "string" && { to }),
      ...(typeof repo === "string" && { repo }),
    },
  }
}

/** Médiane et p90 (rang le plus proche) de délais en ms ; `null` sans valeur. */
export const leadTimeStats = (ms: number[]) => {
  if (!ms.length) return null
  const s = [...ms].sort((a, b) => a - b)
  const mid = s.length >> 1
  return {
    median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
    p90: s[Math.ceil(s.length * 0.9) - 1],
  }
}

/**
 * `get_merged` : mes PR mergées chargées (`RepoTree.merged`, fenêtre `mergedDays`), filtrées par jour de merge
 * (UTC, bornes incluses) et repo, plus récentes d'abord, avec le délai ouverture → merge (`leadTime`, format de
 * `ageLabel`) et ses stats. Plage hors de la fenêtre chargée : `outsideWindow` le dit. Valeurs par défaut omises.
 */
export const mergedPayload = (
  ctx: McpContext,
  merged: MergedPr[],
  window: { from: string; to: string } | undefined,
  filters: MergedFilters = {},
) => {
  const head = {
    fetchedAt: ctx.fetchedAt,
    loading: ctx.loading,
    error: ctx.error,
  }
  if (!window)
    return omitDefaults({
      ...head,
      notLoaded:
        "Merged PRs are not loaded yet in PR Radar: retry once it has finished loading.",
    }) as Record<string, unknown>
  const from = filters.from ?? window.from
  const to = filters.to ?? window.to
  const needle = filters.repo?.toLowerCase() ?? ""
  const kept = merged
    .filter((p) => {
      const day = p.mergedAt.slice(0, 10)
      return day >= from && day <= to && p.repo.toLowerCase().includes(needle)
    })
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
  const lead = (p: MergedPr) => {
    const ms = Date.parse(p.mergedAt) - Date.parse(p.createdAt)
    return Number.isFinite(ms) ? Math.max(0, ms) : null
  }
  const leads = kept.map(lead).filter((ms): ms is number => ms !== null)
  const stats = leadTimeStats(leads)
  return omitDefaults({
    ...head,
    window,
    outsideWindow:
      from < window.from || to > window.to
        ? `Requested range ${from}..${to} goes beyond the merged PRs loaded in PR Radar (${window.from}..${window.to}, setting "Recently merged"): only merges inside the loaded window are listed.`
        : null,
    stats: {
      count: kept.length,
      medianLeadTime: stats && ageLabel(stats.median),
      p90LeadTime: stats && ageLabel(stats.p90),
    },
    prs: kept.map((p) => {
      const ms = lead(p)
      return {
        repo: p.repo,
        number: p.number,
        title: p.title,
        url: p.url,
        mergedAt: p.mergedAt,
        leadTime: ms === null ? null : ageLabel(ms),
      }
    }),
  }) as Record<string, unknown>
}

/* ---------- Historique ---------- */

/** Ajoute un appel en tête ; au-delà de 50, les plus anciens sont oubliés. */
export const pushCall = (list: McpCall[], call: McpCall) =>
  [call, ...list].slice(0, MCP_HISTORY_MAX)

/** Appels du jour (jour local). */
export const callsToday = (list: McpCall[], now: Date) =>
  list.filter((c) => new Date(c.at).toDateString() === now.toDateString())
    .length

/** Historique relu du localStorage : entrées mal formées ignorées. */
export const parseHistory = (raw: string | null): McpCall[] => {
  try {
    const list = JSON.parse(raw ?? "[]") as unknown
    return Array.isArray(list)
      ? (list as McpCall[])
          .filter(
            (c) =>
              typeof c?.at === "string" &&
              typeof c.tool === "string" &&
              typeof c.ok === "boolean",
          )
          .slice(0, MCP_HISTORY_MAX)
      : []
  } catch {
    return []
  }
}

/* ---------- Installation ---------- */

export type McpClient =
  | "antigravity"
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "cursor"
  | "devin"
  | "gemini"
  | "vscode"
  | "windsurf"
  | "zed"
  | "other"

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const json = (v: unknown) => JSON.stringify(v, null, 2)

/** Ce que l'utilisateur colle pour brancher son agent, avec le chemin réel du binaire. */
export const installSnippet = (client: McpClient, exe: string) => {
  const server = { command: exe, args: ["--mcp"] }
  switch (client) {
    case "claude-code":
      return `claude mcp add --scope user pr-radar -- ${shellQuote(exe)} --mcp`
    case "antigravity":
    case "claude-desktop":
    case "windsurf":
      return json({ mcpServers: { "pr-radar": server } })
    case "codex":
      return `codex mcp add pr-radar -- ${shellQuote(exe)} --mcp`
    case "devin":
      return `devin mcp add -s user pr-radar -- ${shellQuote(exe)} --mcp`
    case "cursor":
      return json({ mcpServers: { "pr-radar": { type: "stdio", ...server } } })
    case "gemini":
      // `--` : sinon gemini lit `--mcp` comme une de ses options
      return `gemini mcp add --scope user pr-radar ${shellQuote(exe)} -- --mcp`
    case "vscode":
      return `code --add-mcp ${shellQuote(
        JSON.stringify({ name: "pr-radar", type: "stdio", ...server }),
      )}`
    case "zed":
      return json({ context_servers: { "pr-radar": server } })
    case "other":
      return `${shellQuote(exe)} --mcp`
  }
}
