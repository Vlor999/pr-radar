// Serveur MCP local : logique pure (testée). Le câblage Tauri est dans `mcp.ts`.
import type {
  McpCall,
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

export type McpTool = "get_prs" | "get_pr"

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
    reviewers: { reviews: p.reviews, requested: p.requested },
    stack: { parent: parents.get(p.url) ?? null, native: p.stack ?? null },
    // PR d'un autre (assignée, mentionné, impliqué) ; null : une de mes PR
    involved: p.involved ?? null,
    slack: slack?.list ?? null,
    slackCheckedAt: slack ? new Date(slack.at).toISOString() : null,
  }
}

/** `get_prs` : mes PR ouvertes et celles des autres qui me concernent (avec mentions Slack) et l'onglet « À reviewer » (`slack: null`). */
export const prsPayload = (
  ctx: McpContext,
  prs: Pr[],
  reviews: ReviewPr[],
  parents: Map<string, number | null>,
  mentionsOf: MentionsOf,
) => ({
  ...ctx,
  prs: prs.map((p) => compactPr(p, parents, mentionsOf)),
  reviews: reviews.map((r) => ({ ...r, slack: null })),
})

/** URL de PR comparable : sans `#…`, `?…`, `/files`, `/commits`, `/` final, casse ignorée. */
export const normalizeUrl = (url: string) =>
  url
    .trim()
    .replace(/[#?].*$/, "")
    .replace(/\/(files|commits|checks)(\/.*)?$/, "")
    .replace(/\/+$/, "")
    .toLowerCase()

/** `get_pr` : une PR ouverte de l'arbre (à moi, ou d'un autre qui me concerne), fils non résolus et conversation en texte. */
export const prPayload = (
  ctx: McpContext,
  url: string,
  prs: Pr[],
  reviews: ReviewPr[],
  parents: Map<string, number | null>,
  mentionsOf: MentionsOf,
  toText: (html: string) => string,
): { ok: true; data: unknown } | { ok: false; error: string } => {
  const key = normalizeUrl(url)
  const pr = prs.find((p) => normalizeUrl(p.url) === key)
  if (!pr)
    return {
      ok: false,
      error: reviews.some((r) => normalizeUrl(r.url) === key)
        ? `PR waiting for your review: get_pr only covers the open PRs of the "Open PRs" tree, yours and those where you are assigned, mentioned or involved (details of the review queue are not loaded). Use get_prs for its summary.`
        : `PR not found among the open PRs loaded in PR Radar (yours, or where you are assigned, mentioned or involved): ${url}`,
    }
  const comment = (c: Thread["comments"][number] | Note) => ({
    author: c.author,
    at: c.at,
    url: c.url,
    ...("state" in c && c.state && { state: c.state }),
    body: toText(c.body),
  })
  return {
    ok: true,
    data: {
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
    },
  }
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
