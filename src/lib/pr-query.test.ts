import assert from "node:assert/strict"
import { test } from "node:test"

import { isStackFieldError, queryFor } from "./pr-query.ts"

test("github.com demande les stacks natifs, pas un GitHub Enterprise", () => {
  assert.match(queryFor("github.com"), /stackEntry/)
  assert.doesNotMatch(queryFor("ghe.example.com"), /stackEntry/)
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
