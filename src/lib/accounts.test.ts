import assert from "node:assert/strict"
import { test } from "node:test"

import {
  apiUrl,
  byAccount,
  DEFAULT_ID,
  describeErrors,
  GITHUB,
  graphqlUrl,
  newAccountId,
  normalizeHost,
  repoKey,
  savedAccounts,
  settle,
  sortReads,
  splitKey,
  toPersist,
  type Account,
} from "./accounts.ts"

const account = (extra: Partial<Account> = {}): Account => ({
  id: DEFAULT_ID,
  host: GITHUB,
  source: "pat",
  ...extra,
})

test("github.com garde api.github.com, un hôte Enterprise passe par /api", () => {
  assert.equal(apiUrl(GITHUB), "https://api.github.com")
  assert.equal(graphqlUrl(GITHUB), "https://api.github.com/graphql")
  assert.equal(apiUrl("ghe.acme.test"), "https://ghe.acme.test/api/v3")
  assert.equal(graphqlUrl("ghe.acme.test"), "https://ghe.acme.test/api/graphql")
})

test("l'hôte saisi est nettoyé : schéma, casse, barre finale", () => {
  assert.equal(normalizeHost(" https://GHE.acme.test/ "), "ghe.acme.test")
  assert.equal(normalizeHost("ghe.acme.test:8443"), "ghe.acme.test:8443")
})

test("un hôte qui n'en est pas un est refusé", () => {
  for (const bad of [
    "",
    "http://ghe.acme.test",
    "ghe.acme.test/path",
    "user@ghe.acme.test",
    "*.acme.test",
    "-acme.test",
    "acme..test",
  ])
    assert.equal(normalizeHost(bad), null, bad)
})

test("sans comptes enregistrés, le jeton unique d'origine devient le compte par défaut", () => {
  assert.deepEqual(savedAccounts(null, "oauth"), [account({ source: "oauth" })])
  assert.deepEqual(savedAccounts(null, null), [account()])
})

test("les comptes enregistrés sont repris tels quels", () => {
  const saved = [account({ id: "me@ghe.acme.test", host: "ghe.acme.test" })]
  assert.equal(savedAccounts(saved, "oauth"), saved)
  assert.deepEqual(savedAccounts([], "oauth"), [])
})

test("le premier compte github.com reprend l'id d'origine, les suivants login@hôte", () => {
  assert.equal(newAccountId([], GITHUB, "me"), DEFAULT_ID)
  assert.equal(newAccountId([account()], GITHUB, "work"), "work@github.com")
  assert.equal(newAccountId([], "ghe.acme.test", "me"), "me@ghe.acme.test")
})

test("un repo du compte d'origine garde sa clé owner/name", () => {
  assert.equal(repoKey(DEFAULT_ID, "acme/web"), "acme/web")
  assert.deepEqual(splitKey("acme/web"), {
    account: DEFAULT_ID,
    name: "acme/web",
  })
})

test("un repo d'un autre compte est préfixé par son id, port compris", () => {
  const key = repoKey("me@ghe.acme.test:8443", "acme/web")
  assert.equal(key, "me@ghe.acme.test:8443:acme/web")
  assert.deepEqual(splitKey(key), {
    account: "me@ghe.acme.test:8443",
    name: "acme/web",
  })
})

test("les repos suivis sont répartis par compte, ceux d'un compte absent ignorés", () => {
  const ghe = account({ id: "me@ghe.acme.test", host: "ghe.acme.test" })
  const keys = ["acme/web", "me@ghe.acme.test:globex/billing", "x@y:acme/api"]
  assert.deepEqual(byAccount(keys, [account(), ghe]), [
    [account(), ["acme/web"]],
    [ghe, ["globex/billing"]],
  ])
  assert.deepEqual(byAccount(["acme/web"], [ghe]), [])
})

test("un trousseau illisible garde le compte, un jeton absent le retire", () => {
  const ok = account()
  const missing = account({ id: "gone@github.com" })
  const locked = account({ id: "me@ghe.acme.test", host: "ghe.acme.test" })
  assert.deepEqual(
    sortReads([
      [ok, "t"],
      [missing, null],
      [locked, undefined],
    ]),
    { live: [ok], kept: [locked] },
  )
})

test("la liste enregistrée garde les comptes illisibles, sans doublon d'id", () => {
  const locked = account({ host: "ghe.acme.test", id: "me@ghe.acme.test" })
  const fresh = account({ source: "oauth" })
  assert.deepEqual(toPersist([fresh], [locked, account()]), [fresh, locked])
})

test("un compte en échec n'empêche pas les autres d'être lus", async () => {
  const ghe = account({
    id: "me@ghe.acme.test",
    host: "ghe.acme.test",
    login: "me",
  })
  const down = new Error("HTTP 502")
  const res = await settle([account(), ghe], async (a) => {
    if (a === ghe) throw down
    return ["acme/web"]
  })
  assert.deepEqual(res, {
    data: ["acme/web"],
    errors: [{ account: ghe, error: down }],
  })
  assert.equal(describeErrors(res.errors), "me (ghe.acme.test) : HTTP 502")
})

test("tous les comptes en échec : la première erreur est levée", async () => {
  const down = new Error("HTTP 502")
  await assert.rejects(
    settle([account()], async () => {
      throw down
    }),
    down,
  )
})
