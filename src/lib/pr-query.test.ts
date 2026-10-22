import assert from "node:assert/strict"
import { test } from "node:test"

import { isStackFieldError, queryFor, withStackFallback } from "./pr-query.ts"

test("github.com demande les stacks natifs, pas un GitHub Enterprise", () => {
  assert.match(queryFor("github.com"), /stackEntry/)
  assert.doesNotMatch(queryFor("ghe.example.com"), /stackEntry/)
})

test("le marqueur STACK ne reste jamais dans la requête", () => {
  assert.doesNotMatch(queryFor("github.com"), /STACK\b/)
  assert.doesNotMatch(queryFor("github.com", true), /STACK\b/)
})

test("sans les stacks une fois le champ refusé", () => {
  assert.doesNotMatch(queryFor("github.com", true), /stackEntry/)
})

test("seule une erreur sur stackEntry déclenche le repli", () => {
  assert.equal(
    isStackFieldError(
      new Error("Field 'stackEntry' doesn't exist on type 'PullRequest'"),
    ),
    true,
  )
  assert.equal(isStackFieldError(new Error("Something went wrong")), false)
})

const FIELD_ERROR = new Error(
  "Field 'stackEntry' doesn't exist on type 'PullRequest'",
)

test("un refus de stackEntry relance une fois sans le champ", async () => {
  const queries: string[] = []
  let refused = false
  const out = await withStackFallback(
    "github.com",
    false,
    async (q) => {
      queries.push(q)
      if (q.includes("stackEntry")) throw FIELD_ERROR
      return "ok"
    },
    () => (refused = true),
  )
  assert.equal(out, "ok")
  assert.equal(refused, true)
  assert.deepEqual(
    queries.map((q) => q.includes("stackEntry")),
    [true, false],
  )
})

test("une autre erreur remonte sans relance", async () => {
  let calls = 0
  await assert.rejects(
    withStackFallback(
      "github.com",
      false,
      async () => {
        calls++
        throw new Error("Something went wrong")
      },
      () => {},
    ),
    /Something went wrong/,
  )
  assert.equal(calls, 1)
})

test("pas de relance quand le champ est déjà écarté", async () => {
  let calls = 0
  await assert.rejects(
    withStackFallback(
      "github.com",
      true,
      async () => {
        calls++
        throw FIELD_ERROR
      },
      () => {},
    ),
  )
  assert.equal(calls, 1)
})
