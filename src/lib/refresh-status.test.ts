import assert from "node:assert/strict"
import { test } from "node:test"

import { refreshStatus } from "./refresh-status.ts"

const ALL = ["github", "me@ghe.acme.test"]
const status = (over: Partial<Parameters<typeof refreshStatus>[0]> = {}) =>
  refreshStatus({ accounts: ALL, prErrors: [], reviewErrors: [], ...over })

test("sans erreur, l'actualisation est réussie", () => {
  assert.equal(status(), "ok")
})

test("un compte en échec parmi d'autres rend l'actualisation partielle", () => {
  assert.equal(status({ prErrors: ["github"] }), "partial")
})

test("la lecture des PR mergées en échec rend l'actualisation partielle", () => {
  assert.equal(status({ mergedError: "HTTP 502" }), "partial")
})

test("la lecture des PR en échec pour tous les comptes fait échouer l'actualisation", () => {
  assert.equal(status({ prErrors: ["me@ghe.acme.test", "github"] }), "failed")
})

test("les PR lues mais toutes les recherches de reviews en échec rendent l'actualisation partielle", () => {
  assert.equal(status({ reviewErrors: ALL }), "partial")
})

test("un compte nommé deux fois en échec ne compte qu'une fois", () => {
  assert.equal(status({ prErrors: ["github", "github"] }), "partial")
})

test("sans compte interrogé, rien n'est en échec", () => {
  assert.equal(status({ accounts: [] }), "ok")
})
