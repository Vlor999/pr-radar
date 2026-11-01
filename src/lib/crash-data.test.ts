import { test } from "node:test"
import assert from "node:assert/strict"

import {
  admitError,
  anonymizer,
  crashEntries,
  crashIssueUrl,
  crashOf,
  crashReport,
  errorInfo,
  newErrorGate,
  type Crash,
  type Known,
} from "./crash-data.ts"
import {
  WEBVIEW_ERROR_DEDUPE_MS,
  WEBVIEW_ERROR_MAX_PER_MIN,
} from "./constants.ts"
import type { ReportContext } from "./report.ts"
import type { LogEntry } from "./types.ts"

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  ts: 1_000,
  level: "warn",
  event: "github.error",
  ...over,
})

const crash = (over: Partial<Crash> = {}): Crash => ({
  kind: "panic",
  ts: 5_000,
  startedAt: 0,
  until: 10_000,
  message: "boom",
  location: "src/web.rs:1:1",
  ...over,
})

const known = (over: Partial<Known> = {}): Known => ({
  repos: [],
  accounts: [],
  ...over,
})

const ctx: ReportContext = { version: "0.12.0", os: "macOS", web: false }

const params = (url: string) => new URL(url).searchParams

test("session précédente avec panic : plantage de type panic, à l'heure du panic", () => {
  assert.deepEqual(
    crashOf(
      { startedAt: 10, panic: { ts: 50, message: "boom", location: null } },
      100,
    ),
    {
      kind: "panic",
      ts: 50,
      startedAt: 10,
      until: 100,
      message: "boom",
      location: undefined,
    },
  )
})

test("session précédente sans panic : fermeture inattendue, heure inconnue", () => {
  assert.deepEqual(crashOf({ startedAt: 10 }, 100), {
    kind: "unclean",
    ts: null,
    startedAt: 10,
    until: 100,
  })
})

test("journal du rapport : avertissements et erreurs de la session plantée, dans l'ordre", () => {
  const newest = [
    entry({ ts: 12_000 }),
    entry({ ts: 9_000, level: "error" }),
    entry({ ts: 8_000, level: "info" }),
    entry({ ts: 7_000 }),
    entry({ ts: 6_000 }),
    entry({ ts: 500 }),
  ]
  assert.deepEqual(
    crashEntries(newest, { startedAt: 1_000, until: 10_000 }, 2).map(
      (e) => e.ts,
    ),
    [7_000, 9_000],
  )
})

test("anonymisation : repos connus et vus dans le journal numérotés dans l'ordre d'apparition", () => {
  const anon = anonymizer(known({ repos: ["globex/billing"] }), [
    { repo: "acme/web" },
    "see https://api.github.com/repos/initech/tps/pulls and globex/billing",
  ])
  assert.equal(
    anon("acme/web, globex/billing, initech/tps, ACME/WEB"),
    "repo-1, repo-3, repo-2, repo-1",
  )
})

test("anonymisation : nom de repo plus long remplacé en entier, pas par préfixe", () => {
  const anon = anonymizer(known({ repos: ["acme/web", "acme/web-app"] }), [])
  assert.equal(anon("acme/web-app acme/web"), "repo-2 repo-1")
})

test("anonymisation : compte GitHub Enterprise, login et hôte remplacés, compte d'origine gardé", () => {
  const anon = anonymizer(
    known({
      accounts: [
        { id: "github", host: "github.com", login: "octocat" },
        { id: "alice@ghe.corp.com", host: "ghe.corp.com", login: "alice" },
      ],
    }),
    [],
  )
  assert.equal(
    anon("github alice@ghe.corp.com https://ghe.corp.com/api octocat alice"),
    "github account-1 https://host-1/api account-2 account-3",
  )
})

test("rapport : jetons expurgés et repos anonymisés dans le message et le journal", () => {
  const r = crashReport(
    crash({ message: "token ghp_abcdefghijklmnopqrstuvwxyz for acme/web" }),
    [entry({ data: { repo: "acme/web", error: "Bearer abcdefghijklmnop" } })],
    known(),
    "en",
  )
  assert.match(r.description, /- Message: `token \[redacted\] for repo-1`/)
  assert.doesNotMatch(r.description + r.logs, /acme|ghp_|abcdefghijklmnop/)
  assert.match(r.logs, /"repo":"repo-1"/)
  assert.match(r.logs, /Bearer \[redacted\]/)
  assert.equal(r.title, "Crash: Rust panic")
})

test("rapport de fermeture inattendue : heure inconnue, lancement de la session indiqué", () => {
  const r = crashReport(
    crash({ kind: "unclean", ts: null, startedAt: 0, message: undefined }),
    [],
    known(),
    "fr",
  )
  assert.match(r.description, /- Type: fermeture inattendue/)
  assert.match(r.description, /- Heure: inconnue \(session lancée le inconnu/)
})

test("adresse d'issue : formulaire crash.yml, label crash, champs préremplis par id", () => {
  const p = params(
    crashIssueUrl({ title: "T", description: "D", logs: "L" }, ctx, "en"),
  )
  assert.equal(p.get("template"), "crash.yml")
  assert.equal(p.get("labels"), "crash")
  assert.equal(p.get("description"), "D")
  assert.equal(p.get("version"), "0.12.0")
  assert.equal(p.get("os"), "macOS · desktop app")
  assert.equal(p.get("logs"), "L")
  assert.equal(p.get("body"), null)
})

test("adresse trop longue : lignes les plus anciennes du journal retirées d'abord", () => {
  const logs = Array.from(
    { length: 200 },
    (_, i) => `line-${i} ${"x".repeat(40)}`,
  ).join("\n")
  const url = crashIssueUrl(
    { title: "T", description: "D", logs },
    ctx,
    "en",
    3_000,
  )
  assert.ok(url.length <= 3_000)
  const kept = params(url).get("logs")!.split("\n")
  assert.match(kept[0], /^# \d+ older line\(s\) removed/)
  assert.equal(kept.at(-1), `line-199 ${"x".repeat(40)}`)
  assert.equal(params(url).get("description"), "D")
})

test("adresse trop longue même sans journal : description tronquée", () => {
  const url = crashIssueUrl(
    { title: "T", description: "d".repeat(5_000), logs: "L" },
    ctx,
    "en",
    2_000,
  )
  assert.ok(url.length <= 2_000)
  assert.match(params(url).get("description")!, /_\[text truncated/)
})

test("erreurs de la webview : même message ignoré pendant le délai", () => {
  const gate = newErrorGate()
  assert.equal(admitError(gate, "a", 0), true)
  assert.equal(admitError(gate, "a", 1_000), false)
  assert.equal(admitError(gate, "a", WEBVIEW_ERROR_DEDUPE_MS), true)
})

test("erreurs de la webview : au plus N par minute, tous messages confondus", () => {
  const gate = newErrorGate()
  for (let i = 0; i < WEBVIEW_ERROR_MAX_PER_MIN; i++)
    assert.equal(admitError(gate, `e${i}`, i), true)
  assert.equal(admitError(gate, "other", 100), false)
  assert.equal(admitError(gate, "other", 60_001), true)
})

test("erreur quelconque : message et pile lus, valeur non Error convertie", () => {
  const e = new Error("bad")
  assert.deepEqual(errorInfo(e), { message: "bad", stack: e.stack })
  assert.deepEqual(errorInfo("oops"), { message: "oops" })
  assert.deepEqual(errorInfo({ code: 1 }), { message: '{"code":1}' })
})
