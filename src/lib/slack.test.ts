import assert from "node:assert/strict"
import { test } from "node:test"

import {
  dueUrls,
  filterMentions,
  isAuthError,
  matchesState,
  mentionsUrl,
  mergeQueue,
  needsRefresh,
  nextReadAt,
  pkceChallenge,
  rateLimitWait,
  sameState,
  SlackError,
  toMentions,
  toTokens,
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

test("Retry-After plafonné à 60 s, 30 s si nul, négatif ou invalide", () => {
  assert.equal(rateLimitWait(429, undefined, "600"), 60)
  assert.equal(rateLimitWait(429, undefined, "0"), 30)
  assert.equal(rateLimitWait(429, undefined, "-5"), 30)
  assert.equal(rateLimitWait(429, undefined, null), 30)
})

test("jetons lus dans authed_user (code) ou à la racine (refresh)", () => {
  const now = 1_000
  assert.deepEqual(
    toTokens(
      {
        authed_user: {
          access_token: "xoxp-1",
          refresh_token: "xoxe-1",
          expires_in: 43_200,
        },
      },
      now,
    ),
    { access: "xoxp-1", refresh: "xoxe-1", expiresAt: now + 43_200_000 },
  )
  assert.deepEqual(
    toTokens(
      { access_token: "xoxp-2", refresh_token: "xoxe-2", expires_in: 60 },
      now,
    ),
    { access: "xoxp-2", refresh: "xoxe-2", expiresAt: now + 60_000 },
  )
  assert.deepEqual(toTokens({ authed_user: { access_token: "xoxp-3" } }, now), {
    access: "xoxp-3",
    refresh: null,
    expiresAt: null,
  })
  assert.throws(() => toTokens({}, now))
})

test("seul un jeton refusé expire la session, pas une erreur passagère", () => {
  const refresh = (code: string) => new SlackError("oauth.v2.access", code)
  assert.ok(isAuthError(refresh("invalid_refresh_token")))
  assert.ok(isAuthError(refresh("token_revoked")))
  assert.ok(isAuthError(refresh("invalid_auth")))
  assert.ok(!isAuthError(refresh("HTTP 503")))
  assert.ok(!isAuthError(refresh("ratelimited")))
  assert.ok(!isAuthError(new TypeError("Failed to fetch")))
})

test("une recherche en échec répétée ne relance pas la file", () => {
  const before = {
    team: { id: "T1", name: "acme" },
    expired: false,
    error: "Slack search.messages : missing_scope",
  }
  assert.ok(sameState(before, { ...before }))
  assert.ok(!sameState(before, { ...before, error: undefined }))
  const now = 1_000_000
  const cache = new Map([[URL, { at: now }]]) // échec enregistré comme une lecture
  assert.deepEqual(dueUrls([URL], cache, now + 1_000), [])
  assert.deepEqual(dueUrls([URL], cache, now + 10 * 60_000 + 1), [URL])
  assert.deepEqual(
    dueUrls(["https://github.com/acme/web/pull/13"], cache, now),
    ["https://github.com/acme/web/pull/13"],
  )
})

test("un retour OAuth avec un autre state est ignoré", () => {
  assert.ok(matchesState("code=1.2&state=abc", "abc"))
  assert.ok(!matchesState("code=1.2&state=forged", "abc"))
  assert.ok(!matchesState("code=1.2", "abc"))
})

const PR13 = "https://github.com/acme/web/pull/13"
const PR14 = "https://github.com/acme/web/pull/14"

test("une actualisation pendant la lecture ajoute les PR à la suite de la file, sans doublon", () => {
  assert.deepEqual(mergeQueue([URL, PR13], [PR13, PR14, PR14], null), [
    URL,
    PR13,
    PR14,
  ])
})

test("la PR en cours de lecture n'est pas remise dans la file", () => {
  assert.deepEqual(mergeQueue([PR13], [URL, PR14], URL), [PR13, PR14])
})

test("prochaine relecture : plus ancienne lecture des PR affichées + 10 min", () => {
  const cache = new Map([
    [URL, { at: 2_000 }],
    [PR13, { at: 1_000 }], // PR fermée, plus affichée
  ])
  assert.equal(nextReadAt([URL, PR14], cache), 2_000 + 10 * 60_000)
})

test("aucune PR affichée encore lue : pas de prochaine relecture", () => {
  assert.equal(nextReadAt([PR14], new Map([[URL, { at: 1_000 }]])), null)
})
