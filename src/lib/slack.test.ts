import assert from "node:assert/strict"
import { test } from "node:test"

import {
  filterMentions,
  mentionsUrl,
  needsRefresh,
  pkceChallenge,
  rateLimitWait,
  toMentions,
  userIds,
} from "./slack.ts"
import type { SlackMention } from "./types.ts"

const URL = "https://github.com/acme/web/pull/12"

const mention = (extra: Partial<SlackMention> = {}): SlackMention => ({
  author: "alice",
  channelId: "C1",
  where: "#dev",
  at: "2026-10-21T10:00:00.000Z",
  text: "",
  permalink: "https://acme.slack.com/archives/C1/p1",
  ...extra,
})

test("le lien de la PR est reconnu en fin de texte et avant / # | >", () => {
  for (const text of [
    `regarde ${URL}`,
    `${URL}/files`,
    `${URL}#discussion_r1`,
    `<${URL}|acme/web#12>`,
    `<${URL}>`,
  ])
    assert.ok(mentionsUrl(text, URL), text)
})

test("la PR 12 ne correspond pas aux PR 123 ni 12 d'un autre repo", () => {
  assert.ok(!mentionsUrl(`<${URL}3>`, URL))
  assert.ok(!mentionsUrl("<https://github.com/acme/api/pull/12>", URL))
})

test("le jeton est renouvelé quand il expire dans moins de 5 min", () => {
  const now = 1_000_000
  assert.ok(needsRefresh(now + 4 * 60_000, now))
  assert.ok(needsRefresh(now - 1, now))
  assert.ok(!needsRefresh(now + 6 * 60_000, now))
  assert.ok(!needsRefresh(null, now))
})

test("seules les conversations cochées comptent, toutes si « toutes »", () => {
  const list = [mention({ channelId: "C1" }), mention({ channelId: "D1" })]
  assert.deepEqual(
    filterMentions(list, { slackAll: false, slackChannels: ["D1"] }),
    [list[1]],
  )
  assert.deepEqual(
    filterMentions(list, { slackAll: false, slackChannels: [] }),
    [],
  )
  assert.deepEqual(
    filterMentions(list, { slackAll: true, slackChannels: [] }),
    list,
  )
})

test("les résultats de recherche sans le lien exact sont écartés", () => {
  const hit = {
    username: "bob",
    ts: "1761040800.000100",
    text: `<${URL}|#12>`,
    permalink: "https://acme.slack.com/archives/D1/p1",
    channel: { id: "D1", name: "U1", is_im: true },
  }
  const out = toMentions(
    [hit, { ...hit, text: `<${URL}3>`, channel: { id: "C1", name: "dev" } }],
    URL,
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].where, "DM · U1")
  assert.equal(out[0].text, `<${URL}|#12>`)
  assert.equal(out[0].at, "2025-10-21T10:00:00.000Z")
})

test("le challenge PKCE est le SHA-256 du verifier en base64url (RFC 7636)", async () => {
  assert.equal(
    await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  )
})

test("limite Slack : HTTP 429 ou erreur « ratelimited » (HTTP 200), attente de Retry-After", () => {
  assert.equal(rateLimitWait(429, "ratelimited", "12"), 12)
  assert.equal(rateLimitWait(200, "ratelimited", null), 30)
  assert.equal(rateLimitWait(429, undefined, "abc"), 30)
  assert.equal(rateLimitWait(200, undefined, null), null)
  assert.equal(rateLimitWait(200, "invalid_auth", "5"), null)
})

test("DM nommé par son destinataire, DM de groupe par ses participants, mentions nommées", () => {
  const base = {
    username: "bob",
    ts: "1761040800",
    permalink: "https://acme.slack.com/archives/D1/p1",
  }
  const matches = [
    {
      ...base,
      text: `<@U2> ${URL}`,
      channel: { id: "D1", name: "U1", is_im: true },
    },
    {
      ...base,
      text: URL,
      channel: { id: "G1", name: "mpdm-alice--bob--carol-1", is_mpim: true },
    },
    { ...base, text: URL, channel: { id: "C1", name: "dev" } },
  ]
  assert.deepEqual(userIds(matches), ["U2", "U1"])
  const names = new Map([
    ["U1", "Alice Martin"],
    ["U2", "Bob"],
  ])
  const out = toMentions(matches, URL, names)
  assert.deepEqual(
    out.map((m) => m.where),
    ["DM · Alice Martin", "DM · alice, bob, carol", "#dev"],
  )
  assert.equal(out[0].text, `<@U2|Bob> ${URL}`)
})
