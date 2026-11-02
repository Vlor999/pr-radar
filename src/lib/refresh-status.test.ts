import assert from "node:assert/strict"
import { test } from "node:test"

import { refreshStatus } from "./refresh-status.ts"

const status = (over: Partial<Parameters<typeof refreshStatus>[0]> = {}) =>
  refreshStatus({
    accounts: ["github", "me@ghe.acme.test"],
    failedAccounts: [],
    ...over,
  })

test("sans erreur, l'actualisation est réussie", () => {
  assert.equal(status(), "ok")
})

test("un compte en échec parmi d'autres rend l'actualisation partielle", () => {
  assert.equal(status({ failedAccounts: ["github"] }), "partial")
})

test("la lecture des PR mergées en échec rend l'actualisation partielle", () => {
  assert.equal(status({ mergedError: "HTTP 502" }), "partial")
})

test("tous les comptes en échec font échouer l'actualisation", () => {
  assert.equal(
    status({ failedAccounts: ["me@ghe.acme.test", "github"] }),
    "failed",
  )
})

test("un compte nommé deux fois en échec ne compte qu'une fois", () => {
  assert.equal(status({ failedAccounts: ["github", "github"] }), "partial")
})

test("sans compte interrogé, rien n'est en échec", () => {
  assert.equal(status({ accounts: [] }), "ok")
})
