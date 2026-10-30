import assert from "node:assert/strict"
import { test } from "node:test"

import {
  knownWithoutMentions,
  mentionedIds,
  reasonOf,
  uniqueById,
} from "./involved.ts"

const who = (author: string | null, assignees: string[] = []) => ({
  author,
  assignees,
})

test("ma PR n'a pas de motif, même assignée et mentionnée", () => {
  assert.equal(reasonOf(who("me", ["me"]), "me", true), null)
})

test("l'auteur est comparé sans tenir compte de la casse", () => {
  assert.equal(reasonOf(who("Me"), "me", false), null)
})

test("assignée l'emporte sur mentionné", () => {
  assert.equal(reasonOf(who("bob", ["alice", "me"]), "me", true), "assigned")
})

test("mentionné l'emporte sur impliqué", () => {
  assert.equal(reasonOf(who("bob"), "me", true), "mentioned")
})

test("ni auteur, ni assigné, ni mentionné : impliqué", () => {
  assert.equal(reasonOf(who("bob"), "me", false), "involved")
})

test("auteur supprimé (ghost) : PR d'un autre", () => {
  assert.equal(reasonOf(who(null), "me", false), "involved")
})

test("la recherche des mentions n'est utile que hors auteur et assigné", () => {
  assert.equal(knownWithoutMentions(who("me"), "me"), true)
  assert.equal(knownWithoutMentions(who("bob", ["me"]), "me"), true)
  assert.equal(knownWithoutMentions(who("bob"), "me"), false)
})

test("une PR remontée deux fois n'est gardée qu'une fois", () => {
  assert.deepEqual(
    uniqueById([{ id: "a" }, { id: "b" }, { id: "a" }]).map((x) => x.id),
    ["a", "b"],
  )
})

test("mentions : pas de recherche quand toutes les PR sont à moi ou assignées", async () => {
  let searched = false
  const ids = await mentionedIds(
    [who("me"), who("bob", ["me"])],
    "me",
    async () => {
      searched = true
      return []
    },
  )
  assert.equal(searched, false)
  assert.equal(ids.size, 0)
})

test("mentions : ids trouvés pour une PR d'un autre non assignée", async () => {
  const ids = await mentionedIds([who("bob")], "me", async () => [
    { id: "PR_1" },
  ])
  assert.deepEqual([...ids], ["PR_1"])
})

test("mentions : une recherche en échec donne aucun id, sans rejeter", async () => {
  const ids = await mentionedIds([who("bob")], "me", async () => {
    throw new Error("GitHub : HTTP 502")
  })
  assert.equal(ids.size, 0)
})

test("mentions : un jeton refusé (AuthError) rejette", async () => {
  const denied = Object.assign(new Error("Jeton GitHub refusé"), {
    name: "AuthError",
  })
  await assert.rejects(
    mentionedIds([who("bob")], "me", async () => {
      throw denied
    }),
    denied,
  )
})
