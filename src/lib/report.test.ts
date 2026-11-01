import { test } from "node:test"
import assert from "node:assert/strict"

import {
  contextBlock,
  feedbackUrl,
  newDiscussionUrl,
  newIssueUrl,
  osName,
  prefillUrl,
  type ReportContext,
} from "./report.ts"

const ctx = (over: Partial<ReportContext> = {}): ReportContext => ({
  version: "0.11.0",
  os: "macOS",
  web: false,
  ...over,
})

const params = (url: string) => new URL(url).searchParams

test("user agent de la webview : système reconnu", () => {
  assert.equal(
    osName(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    ),
    "macOS",
  )
  assert.equal(
    osName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/120"),
    "Windows",
  )
  assert.equal(
    osName("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15"),
    "Linux",
  )
})

test("user agent mobile ou inconnu : système null", () => {
  assert.equal(
    osName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
    null,
  )
  assert.equal(osName("Mozilla/5.0 (Linux; Android 14)"), null)
  assert.equal(osName(""), null)
})

test("contexte : version, système et interface, dans la langue choisie", () => {
  assert.equal(
    contextBlock(ctx(), "en"),
    "---\n### Context\n- Version: 0.11.0\n- OS: macOS\n- Interface: desktop app",
  )
  assert.match(
    contextBlock(ctx({ web: true }), "fr"),
    /- Interface: version web$/,
  )
})

test("contexte : version et système inconnus affichés comme tels", () => {
  const block = contextBlock(ctx({ version: null, os: null }), "fr")
  assert.match(block, /- Version: inconnu\n- Système: inconnu/)
})

test("discussion : catégorie, titre et corps encodés, contexte sous le message", () => {
  const url = newDiscussionUrl(
    "ideas",
    { title: "Idée & question ?", body: "Un #hashtag\n+ 50 %", footer: "ctx" },
    "fr",
  )
  assert.ok(
    url.startsWith(
      "https://github.com/Vlor999/pr-radar/discussions/new?category=ideas&title=",
    ),
  )
  assert.equal(params(url).get("title"), "Idée & question ?")
  assert.equal(params(url).get("body"), "Un #hashtag\n+ 50 %\n\nctx")
  assert.doesNotMatch(url, /[ #\n]/)
})

test("issue : modèle et labels ajoutés seulement s'ils sont donnés", () => {
  const plain = newIssueUrl({ title: "t", body: "b" }, "en")
  assert.equal(
    plain,
    "https://github.com/Vlor999/pr-radar/issues/new?title=t&body=b",
  )
  const crash = newIssueUrl({ title: "t", body: "b" }, "en", {
    template: "crash.yml",
    labels: ["bug", "crash"],
  })
  assert.equal(params(crash).get("template"), "crash.yml")
  assert.equal(params(crash).get("labels"), "bug,crash")
})

test("adresse trop longue : corps tronqué et marqué, contexte gardé, longueur respectée", () => {
  const url = prefillUrl(
    "https://github.com/x",
    [],
    { title: "t", body: "é".repeat(5_000), footer: "### Context" },
    "en",
    1_000,
  )
  assert.ok(url.length <= 1_000)
  const body = params(url).get("body") ?? ""
  assert.match(
    body,
    /^é+\n\n_\[text truncated: address too long\]_\n\n### Context$/,
  )
})

test("troncature : un emoji n'est jamais coupé en deux", () => {
  const url = prefillUrl(
    "https://x",
    [],
    { title: "t", body: "😀".repeat(500) },
    "en",
    300,
  )
  assert.ok(url.length <= 300)
  assert.match(params(url).get("body") ?? "", /^(😀)+\n\n_\[/)
})

test("avis : discussion préremplie, sans message le texte d'aide puis le contexte", () => {
  const url = feedbackUrl(ctx({ web: true }), "en")
  assert.equal(params(url).get("category"), "ideas")
  assert.equal(params(url).get("title"), "Feedback on PR Radar")
  assert.match(
    params(url).get("body") ?? "",
    /^<!-- .+ -->\n\n---\n### Context\n- Version: 0\.11\.0\n- OS: macOS\n- Interface: web version$/,
  )
})
