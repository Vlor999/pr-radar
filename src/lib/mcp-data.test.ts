import assert from "node:assert/strict"
import { test } from "node:test"

import {
  actionReasons,
  callsToday,
  htmlToText,
  installSnippet,
  MCP_HISTORY_MAX,
  normalizeUrl,
  parentsOf,
  parseHistory,
  parsePrsArgs,
  prPayload,
  prsPayload,
  pushCall,
  slackStatus,
  type HtmlNode,
  type McpContext,
} from "./mcp-data.ts"
import { buildTree } from "./tree.ts"
import type { McpCall, Pr, ReviewPr, SlackMention } from "./types.ts"

const pr = (number: number, extra: Partial<Pr> = {}): Pr => ({
  id: `PR_${number}`,
  repo: "acme/web",
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/web/pull/${number}`,
  head: `b${number}`,
  base: "main",
  draft: false,
  decision: null,
  conflicting: false,
  canUpdateBranch: false,
  sha: null,
  ci: "SUCCESS",
  comments: 0,
  unresolved: 0,
  threads: [],
  conversation: [],
  additions: 1,
  deletions: 2,
  files: 1,
  reviews: [],
  requested: [],
  updated: "2026-01-01T00:00:00Z",
  ...extra,
})

const rv = (extra: Partial<ReviewPr> = {}): ReviewPr => ({
  repo: "acme/api",
  number: 9,
  title: "Review me",
  url: "https://github.com/acme/api/pull/9",
  author: "alice",
  draft: false,
  decision: "REVIEW_REQUIRED",
  direct: true,
  teams: [],
  rerequest: false,
  since: "2026-01-01T00:00:00Z",
  ...extra,
})

const mention = (extra: Partial<SlackMention> = {}): SlackMention => ({
  author: "bob",
  channelId: "C1",
  where: "#dev",
  at: "2026-01-01T00:00:00Z",
  text: "look",
  permalink: "https://acme.slack.com/archives/C1/p1",
  ...extra,
})

const call = (extra: Partial<McpCall> = {}): McpCall => ({
  at: "2026-01-02T10:00:00Z",
  client: "claude-code",
  tool: "get_prs",
  args: {},
  ms: 3,
  ok: true,
  bytes: 10,
  ...extra,
})

const ctx: McpContext = {
  fetchedAt: "2026-01-01T00:00:00Z",
  loading: false,
  error: null,
  slack: { status: "connected", queue: 0, error: null },
}

const noMentions = () => null

/* faux DOM : élément ou texte */
const el = (
  name: string,
  children: (HtmlNode | string)[] = [],
  attrs: Record<string, string> = {},
): HtmlNode => ({
  nodeType: 1,
  nodeName: name,
  textContent: null,
  childNodes: children.map((c) =>
    typeof c === "string"
      ? { nodeType: 3, nodeName: "#text", textContent: c, childNodes: [] }
      : c,
  ),
  getAttribute: (n) => attrs[n] ?? null,
})

type Payload = {
  prs?: Record<string, unknown>[]
  reviews?: Record<string, unknown>[]
} & Record<string, unknown>

const prs = (...args: Parameters<typeof prsPayload>) =>
  prsPayload(...args) as Payload

test("get_prs : mentions absentes si pas cherchées, checkedAt seul si aucune", () => {
  const seen = pr(1)
  const empty = pr(2)
  const unread = pr(3)
  const known = new Map([
    [seen.url, { at: 0, list: [mention()] }],
    [empty.url, { at: 0, list: [] }],
  ])
  const out = prs(
    ctx,
    [seen, empty, unread],
    [rv()],
    new Map(),
    (u) => known.get(u) ?? null,
  )
  const checkedAt = "1970-01-01T00:00:00.000Z"
  assert.deepEqual(
    out.prs?.map((p) => p.slack),
    [{ checkedAt, mentions: [mention()] }, { checkedAt }, undefined],
  )
  assert.equal("slack" in (out.reviews?.[0] ?? {}), false)
})

test("get_prs : valeurs par défaut omises, sans fils ni conversation", () => {
  const out = prs(
    { ...ctx, fetchedAt: null },
    [pr(1, { ci: null, additions: 0 })],
    [rv({ direct: false })],
    new Map(),
    noMentions,
  )
  assert.deepEqual(out, {
    slack: { status: "connected" },
    prs: [
      {
        repo: "acme/web",
        number: 1,
        title: "PR 1",
        url: "https://github.com/acme/web/pull/1",
        head: "b1",
        base: "main",
        deletions: 2,
        files: 1,
        updated: "2026-01-01T00:00:00Z",
      },
    ],
    reviews: [
      {
        repo: "acme/api",
        number: 9,
        title: "Review me",
        url: "https://github.com/acme/api/pull/9",
        author: "alice",
        decision: "REVIEW_REQUIRED",
        since: "2026-01-01T00:00:00Z",
      },
    ],
  })
})

test("get_prs : reviewers en listes de logins par état, équipes à part", () => {
  const out = prs(
    ctx,
    [
      pr(1, {
        reviews: [
          { who: "alice", state: "APPROVED" },
          { who: "bob", state: "CHANGES_REQUESTED" },
          { who: "carol", state: "APPROVED" },
        ],
        requested: [{ who: "dave" }, { who: "Platform", team: true }],
      }),
    ],
    [],
    new Map(),
    noMentions,
  )
  assert.deepEqual(out.prs?.[0].reviewers, {
    approved: ["alice", "carol"],
    changesRequested: ["bob"],
    requested: ["dave"],
    requestedTeams: ["Platform"],
  })
})

test("get_prs : la PR d'un autre donne son motif, la mienne rien", () => {
  const involved = { reason: "mentioned" as const, author: "bob" }
  const out = prs(ctx, [pr(1), pr(2, { involved })], [], new Map(), noMentions)
  assert.deepEqual(
    out.prs?.map((p) => p.involved),
    [undefined, involved],
  )
})

test("get_prs : une PR stackée donne le numéro de sa PR parente", () => {
  const a = pr(1)
  const b = pr(2, { base: "b1" })
  const parents = parentsOf([
    { repo: "acme/web", roots: buildTree([a, b]), merged: [] },
  ])
  const out = prs(ctx, [a, b], [], parents, noMentions)
  assert.deepEqual(
    out.prs?.map((p) => p.parent),
    [undefined, 1],
  )
})

test("get_prs : réponse compacte plus courte que la forme complète", () => {
  const list = Array.from({ length: 20 }, (_, i) =>
    pr(i + 1, {
      draft: i % 5 === 0,
      ci: i % 4 === 0 ? null : "SUCCESS",
      comments: i % 3,
      reviews: i % 2 ? [{ who: "alice", state: "APPROVED" }] : [],
      requested: [{ who: "bob" }],
    }),
  )
  const queue = Array.from({ length: 5 }, (_, i) => rv({ number: 100 + i }))
  const full = JSON.stringify({
    ...ctx,
    prs: list.map((p) => ({
      ...p,
      reviewers: { reviews: p.reviews, requested: p.requested },
      stack: { parent: null, native: null },
      involved: null,
      slack: null,
      slackCheckedAt: null,
    })),
    reviews: queue.map((r) => ({ ...r, slack: null })),
  })
  const compact = JSON.stringify(
    prsPayload(ctx, list, queue, new Map(), noMentions),
  )
  assert.ok(
    compact.length < full.length * 0.6,
    `${compact.length} / ${full.length}`,
  )
})

/* ---------- Filtres de get_prs et actions attendues ---------- */

const thread = (author: string) => ({
  id: `T_${author}`,
  path: "a.ts",
  line: 1,
  outdated: false,
  hunk: "",
  comments: [{ author, body: "?", url: "u", at: "2026-01-01T00:00:00Z" }],
})
const other = { reason: "involved" as const, author: "bob" }

test("actions : ma PR sans rien à faire → aucune raison", () => {
  assert.deepEqual(actionReasons({ pr: pr(1) }, ["me"]), [])
})

test("actions : ma PR donne chaque raison qui s'applique", () => {
  const p = pr(1, {
    ci: "FAILURE",
    decision: "CHANGES_REQUESTED",
    conflicting: true,
    unresolved: 2,
    canUpdateBranch: true,
  })
  assert.deepEqual(actionReasons({ pr: p }, ["me"]), [
    "ciFailing",
    "changesRequested",
    "conflicting",
    "unresolvedThreads",
    "behindBase",
  ])
  assert.deepEqual(actionReasons({ pr: pr(2, { ci: "ERROR" }) }, []), [
    "ciFailing",
  ])
})

test("actions : CI en cours ou PR approuvée ne demandent rien", () => {
  for (const extra of [
    { ci: "PENDING" },
    { decision: "APPROVED" as const },
    { draft: true },
  ])
    assert.deepEqual(actionReasons({ pr: pr(1, extra) }, ["me"]), [])
})

test("actions : PR d'un autre, review demandée à moi nommément (casse ignorée)", () => {
  const p = pr(1, {
    involved: other,
    requested: [{ who: "Me" }, { who: "me", team: true }],
  })
  assert.deepEqual(actionReasons({ pr: p }, ["me"]), ["reviewRequested"])
  const team = pr(2, {
    involved: other,
    requested: [{ who: "me", team: true }],
  })
  assert.deepEqual(actionReasons({ pr: team }, ["me"]), [])
})

test("actions : PR d'un autre, fil non résolu où j'ai écrit seulement", () => {
  const mine = pr(1, {
    involved: other,
    unresolved: 1,
    threads: [thread("me")],
  })
  const theirs = pr(2, {
    involved: other,
    unresolved: 1,
    threads: [thread("carol")],
    ci: "FAILURE",
    conflicting: true,
  })
  assert.deepEqual(actionReasons({ pr: mine }, ["other", "me"]), [
    "inUnresolvedThread",
  ])
  assert.deepEqual(actionReasons({ pr: theirs }, ["me"]), [])
})

test("actions : file « À reviewer » → toujours une review demandée", () => {
  assert.deepEqual(actionReasons({ review: rv({ draft: true }) }, []), [
    "reviewRequested",
  ])
})

const listed = (out: Payload) => ({
  prs: out.prs?.map((p) => p.number) ?? [],
  reviews: out.reviews?.map((r) => r.number) ?? [],
})

const sample = () => ({
  prs: [
    pr(1, { ci: "FAILURE" }),
    pr(2),
    pr(3, { repo: "globex/billing", conflicting: true }),
    pr(4, { involved: other, requested: [{ who: "me" }] }),
    pr(5, { involved: other, repo: "globex/billing" }),
  ],
  reviews: [rv({ number: 10 }), rv({ number: 11, repo: "globex/billing" })],
})

const filtered = (args: unknown) => {
  const parsed = parsePrsArgs(args)
  assert.ok(parsed.ok)
  const { prs: list, reviews } = sample()
  return listed(
    prs(ctx, list, reviews, new Map(), noMentions, parsed.filters, ["me"]),
  )
}

test("get_prs : sans argument, tout est renvoyé", () => {
  assert.deepEqual(filtered({}), { prs: [1, 2, 3, 4, 5], reviews: [10, 11] })
  assert.deepEqual(filtered(undefined), filtered({}))
})

test("get_prs : scope mine / involved / reviews", () => {
  assert.deepEqual(filtered({ scope: "mine" }), { prs: [1, 2, 3], reviews: [] })
  assert.deepEqual(filtered({ scope: "involved" }), {
    prs: [4, 5],
    reviews: [],
  })
  assert.deepEqual(filtered({ scope: "reviews" }), {
    prs: [],
    reviews: [10, 11],
  })
})

test("get_prs : repo en sous-chaîne, casse ignorée, sur les deux listes", () => {
  assert.deepEqual(filtered({ repo: "GLOBEX/" }), {
    prs: [3, 5],
    reviews: [11],
  })
  assert.deepEqual(filtered({ repo: "nope" }), { prs: [], reviews: [] })
})

test("get_prs : needs_action garde ce qui attend une action de ma part", () => {
  assert.deepEqual(filtered({ needs_action: true }), {
    prs: [1, 3, 4],
    reviews: [10, 11],
  })
  assert.deepEqual(
    filtered({ needs_action: true, scope: "mine", repo: "acme" }),
    { prs: [1], reviews: [] },
  )
})

test("get_prs : limit par liste, truncated compte le reste", () => {
  const { prs: list, reviews } = sample()
  const out = prs(ctx, list, reviews, new Map(), noMentions, {
    scope: "all",
    needsAction: false,
    limit: 2,
  })
  assert.deepEqual(listed(out), { prs: [1, 2], reviews: [10, 11] })
  assert.deepEqual(out.truncated, { prs: 3 })
})

test("get_prs : truncated absent quand rien n'est coupé", () => {
  const { prs: list, reviews } = sample()
  const out = prs(ctx, list, reviews, new Map(), noMentions, {
    scope: "all",
    needsAction: false,
    limit: 10,
  })
  assert.equal("truncated" in out, false)
})

test("arguments de get_prs : valeurs valides, null vaut absent", () => {
  assert.deepEqual(parsePrsArgs(null), {
    ok: true,
    filters: { scope: "all", needsAction: false },
  })
  assert.deepEqual(
    parsePrsArgs({
      repo: "acme",
      scope: "reviews",
      needs_action: true,
      limit: 5,
    }),
    {
      ok: true,
      filters: { repo: "acme", scope: "reviews", needsAction: true, limit: 5 },
    },
  )
  assert.deepEqual(parsePrsArgs({ scope: null, limit: null }), {
    ok: true,
    filters: { scope: "all", needsAction: false },
  })
})

test("arguments de get_prs : limit écrit 1.0 ou 3e0 accepté, comme dans le shim", () => {
  for (const [raw, limit] of [
    ['{"limit":1.0}', 1],
    ['{"limit":3e0}', 3],
  ] as const)
    assert.deepEqual(parsePrsArgs(JSON.parse(raw)), {
      ok: true,
      filters: { scope: "all", needsAction: false, limit },
    })
})

test("arguments de get_prs : type ou valeur invalide → erreur explicite", () => {
  const cases: [unknown, string][] = [
    ["x", "get_prs: arguments must be an object"],
    [[], "get_prs: arguments must be an object"],
    [{ repo: 1 }, "get_prs: `repo` must be a string"],
    [
      { scope: "team" },
      "get_prs: `scope` must be one of mine, involved, reviews, all",
    ],
    [{ needs_action: "yes" }, "get_prs: `needs_action` must be a boolean"],
    [{ limit: 0 }, "get_prs: `limit` must be an integer >= 1"],
    [{ limit: 1.5 }, "get_prs: `limit` must be an integer >= 1"],
    [{ limit: 1e20 }, "get_prs: `limit` must be an integer >= 1"],
    [{ limit: "3" }, "get_prs: `limit` must be an integer >= 1"],
    [{ state: "open" }, "get_prs: unknown argument `state`"],
  ]
  for (const [args, error] of cases)
    assert.deepEqual(parsePrsArgs(args), { ok: false, error })
})

test("get_pr : fils et conversation en texte, URL avec /files acceptée", () => {
  const p = pr(1, {
    threads: [
      {
        id: "T1",
        path: "a.ts",
        line: 3,
        outdated: false,
        hunk: "+x",
        comments: [{ author: "alice", body: "<p>fix</p>", url: "u", at: "t" }],
      },
    ],
    conversation: [
      {
        author: "bob",
        body: "<p>ok</p>",
        url: "v",
        at: "t",
        state: "APPROVED",
      },
    ],
  })
  const r = prPayload(
    ctx,
    `${p.url}/files#diff`,
    [p],
    [],
    new Map(),
    noMentions,
    (h) => h.replace(/<[^>]+>/g, ""),
  )
  assert.equal(r.ok, true)
  const data = (r as { data: { pr: Record<string, unknown> } }).data.pr
  assert.deepEqual(data.threads, [
    {
      path: "a.ts",
      line: 3,
      hunk: "+x",
      comments: [{ author: "alice", at: "t", url: "u", body: "fix" }],
    },
  ])
  assert.deepEqual(data.conversation, [
    { author: "bob", at: "t", url: "v", state: "APPROVED", body: "ok" },
  ])
})

test("get_pr : PR inconnue ou à reviewer → erreur explicite", () => {
  const unknown = prPayload(
    ctx,
    "https://github.com/x/y/pull/1",
    [],
    [],
    new Map(),
    noMentions,
    String,
  )
  const review = prPayload(
    ctx,
    rv().url,
    [],
    [rv()],
    new Map(),
    noMentions,
    String,
  )
  assert.equal(unknown.ok, false)
  assert.match((unknown as { error: string }).error, /not found/)
  assert.match((review as { error: string }).error, /waiting for your review/)
})

test("URL de PR normalisée : casse, slash final, onglet, ancre", () => {
  assert.equal(
    normalizeUrl(" https://GitHub.com/acme/web/pull/1/commits/abc?x=1#y "),
    "https://github.com/acme/web/pull/1",
  )
})

test("statut Slack : désactivé sans équipe ou sans conversation choisie", () => {
  assert.equal(
    slackStatus({ connected: false, expired: false, active: true }),
    "disabled",
  )
  assert.equal(
    slackStatus({ connected: true, expired: true, active: false }),
    "disabled",
  )
  assert.equal(
    slackStatus({ connected: true, expired: true, active: true }),
    "expired",
  )
  assert.equal(
    slackStatus({ connected: true, expired: false, active: true }),
    "connected",
  )
})

test("HTML → texte : paragraphes, listes, liens en texte (url)", () => {
  const body = el("BODY", [
    el("P", [
      "Voir ",
      el("A", ["la doc"], { href: "https://x.dev/doc" }),
      " ici",
    ]),
    el("UL", [el("LI", ["un"]), el("LI", ["deux"])]),
    el("P", [
      el("A", ["https://x.dev"], { href: "https://x.dev" }),
      el("BR"),
      "fin",
    ]),
  ])
  assert.equal(
    htmlToText(body),
    "Voir la doc (https://x.dev/doc) ici\n\n- un\n\n- deux\n\nhttps://x.dev\nfin",
  )
})

test("HTML → texte : mention @user sans URL, image par son alt", () => {
  const body = el("P", [
    el("A", ["@alice"], {
      href: "https://github.com/alice",
      class: "user-mention",
    }),
    " ",
    el("IMG", [], { alt: "capture" }),
  ])
  assert.equal(htmlToText(body), "@alice [capture]")
})

test("historique : nouvel appel en tête, 50 gardés au plus", () => {
  let list: McpCall[] = []
  for (let i = 0; i < MCP_HISTORY_MAX + 5; i++)
    list = pushCall(list, call({ ms: i }))
  assert.equal(list.length, MCP_HISTORY_MAX)
  assert.equal(list[0].ms, MCP_HISTORY_MAX + 4)
  assert.equal(list.at(-1)?.ms, 5)
})

test("historique relu : entrées mal formées ou JSON invalide ignorés", () => {
  assert.deepEqual(parseHistory(JSON.stringify([call(), { at: 1 }, null])), [
    call(),
  ])
  assert.deepEqual(parseHistory("{"), [])
  assert.deepEqual(parseHistory(null), [])
})

test("appels du jour : seulement ceux de la date locale courante", () => {
  const now = new Date(2026, 0, 2, 12)
  const list = [
    call({ at: new Date(2026, 0, 2, 9).toISOString() }),
    call({ at: new Date(2026, 0, 1, 23).toISOString() }),
  ]
  assert.equal(callsToday(list, now), 1)
})

test("installation : chemin du binaire cité pour le shell, JSON pour Claude Desktop", () => {
  const exe = "/Applications/PR Radar.app/Contents/MacOS/pr-radar"
  assert.equal(
    installSnippet("claude-code", exe),
    "claude mcp add --scope user pr-radar -- '/Applications/PR Radar.app/Contents/MacOS/pr-radar' --mcp",
  )
  assert.deepEqual(JSON.parse(installSnippet("claude-desktop", exe)), {
    mcpServers: { "pr-radar": { command: exe, args: ["--mcp"] } },
  })
  assert.equal(installSnippet("other", "/a/it's"), `'/a/it'\\''s' --mcp`)
})

test("installation : commande en une ligne pour Codex, Devin, Gemini CLI et VS Code", () => {
  const exe = "/a b/it's"
  const quoted = `'/a b/it'\\''s'`
  assert.equal(
    installSnippet("devin", exe),
    `devin mcp add -s user pr-radar -- ${quoted} --mcp`,
  )
  assert.equal(
    installSnippet("codex", exe),
    `codex mcp add pr-radar -- ${quoted} --mcp`,
  )
  assert.equal(
    installSnippet("gemini", exe),
    `gemini mcp add --scope user pr-radar ${quoted} -- --mcp`,
  )
  const vscode = installSnippet("vscode", exe)
  const prefix = "code --add-mcp '"
  assert.ok(vscode.startsWith(prefix) && vscode.endsWith("'"))
  const unquoted = vscode.slice(prefix.length, -1).replaceAll(`'\\''`, "'")
  assert.deepEqual(JSON.parse(unquoted), {
    name: "pr-radar",
    type: "stdio",
    command: exe,
    args: ["--mcp"],
  })
})

test("installation : JSON au format d'Antigravity, Cursor, Windsurf et Zed", () => {
  const exe = '/a b/say "hi"'
  const server = { command: exe, args: ["--mcp"] }
  assert.deepEqual(JSON.parse(installSnippet("cursor", exe)), {
    mcpServers: { "pr-radar": { type: "stdio", ...server } },
  })
  assert.deepEqual(JSON.parse(installSnippet("antigravity", exe)), {
    mcpServers: { "pr-radar": server },
  })
  assert.deepEqual(JSON.parse(installSnippet("windsurf", exe)), {
    mcpServers: { "pr-radar": server },
  })
  assert.deepEqual(JSON.parse(installSnippet("zed", exe)), {
    context_servers: { "pr-radar": server },
  })
})
