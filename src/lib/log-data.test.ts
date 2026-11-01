import assert from "node:assert/strict"
import { test } from "node:test"

import { DAY_MS, LOG_STRING_MAX_CHARS } from "./constants.ts"
import {
  parseEntries,
  prNumberOf,
  redact,
  retentionCutoff,
  retentionDays,
} from "./log-data.ts"
import type { Pr } from "./types.ts"

const GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"

const pr = (over: Partial<Pr> = {}): Pick<Pr, "id" | "number" | "threads"> => ({
  id: "PR_1",
  number: 12,
  threads: [],
  ...over,
})

test("les jetons GitHub de chaque préfixe sont masqués", () => {
  for (const prefix of ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]) {
    const token = prefix + "x".repeat(36)
    assert.equal(redact(`échec avec ${token} !`), "échec avec [redacted] !")
  }
  assert.equal(
    redact("github_pat_11ABCDEFG0123456789_abcdefghijklmnop"),
    "[redacted]",
  )
})

test("les jetons Slack sont masqués", () => {
  for (const kind of "abprs")
    assert.equal(redact(`xox${kind}-1234-5678-abcdefgh`), "[redacted]")
})

test("la valeur d'un en-tête Authorization ou Bearer est masquée", () => {
  assert.equal(
    redact("Authorization: Bearer abc.def-123456"),
    "Authorization: [redacted]",
  )
  assert.equal(
    redact('{"authorization":"token 1234567890"}'),
    '{"authorization":"[redacted]"}',
  )
  assert.equal(redact("sent Bearer abcdefgh12345"), "sent Bearer [redacted]")
})

test("une clé secrète est masquée quelle que soit sa valeur, le reste est gardé", () => {
  assert.deepEqual(
    redact({
      repo: "acme/api",
      pr: 12,
      headers: { Authorization: "x" },
      token: 1,
    }),
    {
      repo: "acme/api",
      pr: 12,
      headers: { Authorization: "[redacted]" },
      token: "[redacted]",
    },
  )
})

test("un jeton dans un tableau ou une erreur est masqué", () => {
  assert.deepEqual(redact([GH, new Error(`bad ${GH}`)]), [
    "[redacted]",
    "bad [redacted]",
  ])
})

test("le texte ordinaire et les nombres passent tels quels", () => {
  assert.equal(redact("acme/api#12 : HTTP 502"), "acme/api#12 : HTTP 502")
  assert.equal(redact(42), 42)
  assert.equal(redact(null), null)
})

test("une chaîne longue est tronquée", () => {
  const out = redact("y".repeat(LOG_STRING_MAX_CHARS + 50)) as string
  assert.equal(out.length, LOG_STRING_MAX_CHARS + 1)
})

test("une structure cyclique ne boucle pas", () => {
  const a: Record<string, unknown> = { name: "a" }
  a.self = a
  assert.doesNotThrow(() => redact(a))
})

test("conservation : 24 h, 7 jours, ou le nombre de jours choisi", () => {
  assert.equal(retentionDays({ logRetention: "24h", logRetentionDays: 30 }), 1)
  assert.equal(retentionDays({ logRetention: "7d", logRetentionDays: 30 }), 7)
  assert.equal(
    retentionDays({ logRetention: "custom", logRetentionDays: 30 }),
    30,
  )
})

test("la limite de purge est la conservation avant maintenant", () => {
  const now = Date.UTC(2026, 10, 1, 12)
  assert.equal(
    retentionCutoff({ logRetention: "24h", logRetentionDays: 30 }, now),
    now - DAY_MS,
  )
  assert.equal(
    retentionCutoff({ logRetention: "custom", logRetentionDays: 3 }, now),
    Date.UTC(2026, 9, 29, 12),
  )
})

test("le numéro de PR se retrouve depuis le nœud de la PR ou d'un de ses fils", () => {
  const thread = { id: "TH_1" } as Pr["threads"][number]
  const prs = [pr(), pr({ id: "PR_2", number: 34, threads: [thread] })]
  assert.equal(prNumberOf(prs, "PR_1"), 12)
  assert.equal(prNumberOf(prs, "TH_1"), 34)
  assert.equal(prNumberOf(prs, "PR_9"), undefined)
})

test("les entrées mal formées de la lecture sont ignorées", () => {
  const ok = { ts: 1, level: "warn", event: "refresh" }
  assert.deepEqual(
    parseEntries([
      ok,
      { ts: "1", level: "warn", event: "x" },
      { ts: 1, level: "debug", event: "x" },
      null,
    ]),
    [ok],
  )
  assert.deepEqual(parseEntries({}), [])
})
