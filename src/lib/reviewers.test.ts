import assert from "node:assert/strict"
import { test } from "node:test"

import { reviewerCandidates, type Reviewer } from "./reviewers.ts"

const u = (login: string): Reviewer => ({ login, id: `id-${login}` })
const logins = (rs: Reviewer[]) => rs.map((r) => r.login)

test("les suggestions passent avant les utilisateurs assignables", () => {
  assert.deepEqual(
    logins(reviewerCandidates([u("bob")], [u("alice"), u("carol")], [])),
    ["bob", "alice", "carol"],
  )
})

test("un login présent dans les deux listes n'apparaît qu'une fois", () => {
  assert.deepEqual(
    logins(reviewerCandidates([u("Bob")], [u("bob"), u("alice")], [])),
    ["Bob", "alice"],
  )
})

test("l'auteur et les reviews déjà demandées sont exclus, casse ignorée", () => {
  assert.deepEqual(
    logins(
      reviewerCandidates(
        [u("alice"), u("bob")],
        [u("Me"), u("carol")],
        ["me", "ALICE"],
      ),
    ),
    ["bob", "carol"],
  )
})
