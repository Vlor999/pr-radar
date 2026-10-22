import assert from "node:assert/strict"
import { test } from "node:test"

import { gqlFailed, gqlMessage } from "./graphql.ts"

const errors = [{ message: "Resource not accessible by integration" }]

test("une mutation refusée (champ racine null + errors) est un échec", () => {
  assert.equal(
    gqlFailed({ data: { addPullRequestReviewThreadReply: null }, errors }),
    true,
  )
})

test("une recherche partielle (champ racine présent + errors) est gardée", () => {
  assert.equal(
    gqlFailed({ data: { search: { nodes: [null] } }, errors }),
    false,
  )
})

test("sans data, c'est un échec", () => {
  assert.equal(gqlFailed({ errors }), true)
})

test("un champ racine null sans errors est gardé", () => {
  assert.equal(gqlFailed({ data: { x: null } }), false)
})

test("un champ racine null avec errors vide est gardé", () => {
  assert.equal(gqlFailed({ data: { x: null }, errors: [] }), false)
})

test("le message d'échec joint les erreurs de GitHub", () => {
  assert.equal(
    gqlMessage({ errors: [{ message: "a" }, { message: "b" }] }, "HTTP 200"),
    "a ; b",
  )
})

test("sans erreur, le message d'échec retombe sur le statut HTTP", () => {
  assert.equal(gqlMessage({ errors: [] }, "HTTP 502"), "HTTP 502")
  assert.equal(gqlMessage({}, "HTTP 502"), "HTTP 502")
})
