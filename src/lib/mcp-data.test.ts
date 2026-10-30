import assert from "node:assert/strict"
import { test } from "node:test"

import {
  callsToday,
  htmlToText,
  installSnippet,
  MCP_HISTORY_MAX,
  normalizeUrl,
  parentsOf,
  parseHistory,
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

test("get_prs : mention cherchée → liste, PR à reviewer → slack null", () => {
  const seen = pr(1)
  const empty = pr(2)
  const unread = pr(3)
  const known = new Map([
    [seen.url, { at: 0, list: [mention()] }],
    [empty.url, { at: 0, list: [] }],
  ])
  const out = prsPayload(
    ctx,
    [seen, empty, unread],
    [rv()],
    new Map(),
    (u) => known.get(u) ?? null,
  )
  assert.deepEqual(
    out.prs.map((p) => p.slack),
    [[mention()], [], null],
  )
  assert.deepEqual(
    out.prs.map((p) => p.slackCheckedAt),
    ["1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.000Z", null],
  )
  assert.equal(out.reviews[0].slack, null)
})

test("get_prs : format compact, sans fils ni conversation", () => {
  const out = prsPayload(
    ctx,
    [pr(1, { threads: [], conversation: [] })],
    [],
    new Map(),
    noMentions,
  )
  assert.equal(out.fetchedAt, ctx.fetchedAt)
  assert.equal(out.slack.status, "connected")
  assert.equal("threads" in out.prs[0], false)
  assert.equal("conversation" in out.prs[0], false)
  assert.deepEqual(out.prs[0].reviewers, { reviews: [], requested: [] })
})

test("get_prs : une PR stackée donne le numéro de sa PR parente", () => {
  const a = pr(1)
  const b = pr(2, { base: "b1" })
  const parents = parentsOf([
    { repo: "acme/web", roots: buildTree([a, b]), merged: [] },
  ])
  const out = prsPayload(ctx, [a, b], [], parents, noMentions)
  assert.deepEqual(
    out.prs.map((p) => p.stack.parent),
    [null, 1],
  )
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
      outdated: false,
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
