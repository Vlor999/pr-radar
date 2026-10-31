import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  callsToday,
  htmlToText,
  installSnippet,
  type McpOs,
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

test("get_prs : la PR d'un autre donne son motif, la mienne null", () => {
  const involved = { reason: "mentioned" as const, author: "bob" }
  const out = prsPayload(
    ctx,
    [pr(1), pr(2, { involved })],
    [],
    new Map(),
    noMentions,
  )
  assert.deepEqual(
    out.prs.map((p) => p.involved),
    [null, involved],
  )
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

const EXE = `/Applications/PR "Radar".app/it's/pr-radar`
const QUOTED = `'/Applications/PR "Radar".app/it'\\''s/pr-radar'`
const OSES = ["macos", "linux"] as const
const SERVER = { command: EXE, args: ["--mcp"] }

/** fichier de config de chaque client JSON, relatif au dossier personnel */
const CONFIGS = {
  antigravity: () => ".gemini/config/mcp_config.json",
  "claude-desktop": (os: McpOs) =>
    os === "macos"
      ? "Library/Application Support/Claude/claude_desktop_config.json"
      : ".config/Claude/claude_desktop_config.json",
  cursor: () => ".cursor/mcp.json",
  windsurf: () => ".codeium/windsurf/mcp_config.json",
} as const

const entryOf = (client: keyof typeof CONFIGS) =>
  client === "cursor" ? { type: "stdio", ...SERVER } : SERVER

test("installation : même commande CLI sous macOS et Linux, chemin cité pour le shell", () => {
  for (const os of OSES) {
    assert.deepEqual(installSnippet("claude-code", EXE, os), {
      main: `claude mcp add --scope user pr-radar -- ${QUOTED} --mcp`,
    })
    assert.deepEqual(installSnippet("codex", EXE, os), {
      main: `codex mcp add pr-radar -- ${QUOTED} --mcp`,
    })
    assert.deepEqual(installSnippet("gemini", EXE, os), {
      main: `gemini mcp add --scope user pr-radar ${QUOTED} -- --mcp`,
    })
    assert.deepEqual(installSnippet("other", EXE, os), {
      main: `${QUOTED} --mcp`,
    })
  }
})

test("installation : VS Code reçoit le serveur en JSON cité pour le shell", () => {
  for (const os of OSES) {
    const { main } = installSnippet("vscode", EXE, os)
    const prefix = "code --add-mcp '"
    assert.ok(main.startsWith(prefix) && main.endsWith("'"))
    assert.deepEqual(
      JSON.parse(main.slice(prefix.length, -1).replaceAll(`'\\''`, "'")),
      {
        name: "pr-radar",
        type: "stdio",
        ...SERVER,
      },
    )
  }
})

test("installation : Zed reste à coller (settings.json en JSONC)", () => {
  for (const os of OSES) {
    const snippet = installSnippet("zed", EXE, os)
    assert.equal(snippet.manual, undefined)
    assert.deepEqual(JSON.parse(snippet.main), {
      context_servers: { "pr-radar": SERVER },
    })
  }
})

test("installation : clients JSON, commande de fusion par système et JSON manuel en secours", () => {
  for (const client of Object.keys(CONFIGS) as (keyof typeof CONFIGS)[])
    for (const os of OSES) {
      const { main, manual } = installSnippet(client, EXE, os)
      assert.ok(
        main.startsWith(
          os === "macos" ? "osascript -l JavaScript -e '" : "python3 -c '",
        ),
      )
      assert.ok(main.includes(` "$HOME/${CONFIGS[client](os)}" mcpServers '`))
      assert.equal(manual?.file, `~/${CONFIGS[client](os)}`)
      assert.deepEqual(JSON.parse(manual?.json ?? ""), {
        mcpServers: { "pr-radar": entryOf(client) },
      })
    }
})

/** Lance la commande avec un HOME temporaire : jamais la vraie config. */
const runMerge = (main: string, home: string) =>
  execFileSync("/bin/sh", ["-c", main], {
    env: { ...process.env, HOME: home },
    stdio: "pipe",
  })

const runs = (cmd: string) => {
  try {
    execFileSync("/bin/sh", ["-c", cmd], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

for (const [os, tool, available] of [
  ["macos", "osascript", process.platform === "darwin"],
  ["linux", "python3", runs("python3 -c pass")],
] as const)
  test(
    `installation : la commande ${os} fusionne sans écraser, idempotente, avec sauvegarde`,
    { skip: !available && `${tool} absent` },
    () => {
      const home = mkdtempSync(join(tmpdir(), "pr-radar-mcp-"))
      try {
        for (const client of Object.keys(CONFIGS) as (keyof typeof CONFIGS)[]) {
          const file = join(home, CONFIGS[client](os))
          const { main } = installSnippet(client, EXE, os)
          const expected = { "pr-radar": entryOf(client) }

          runMerge(main, home)
          assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
            mcpServers: expected,
          })
          assert.equal(existsSync(`${file}.bak`), false)

          const before = {
            theme: "dark",
            mcpServers: { other: { command: "x" } },
          }
          writeFileSync(file, JSON.stringify(before))
          runMerge(main, home)
          runMerge(main, home)
          assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
            theme: "dark",
            mcpServers: { other: { command: "x" }, ...expected },
          })
          assert.ok(existsSync(`${file}.bak`))

          writeFileSync(file, "{ invalid")
          assert.throws(() => runMerge(main, home))
          assert.equal(readFileSync(file, "utf8"), "{ invalid")
        }
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    },
  )
