import assert from "node:assert/strict"
import { test } from "node:test"

import { gqlFailed, gqlMessage, restRepos, type RepoNode } from "./graphql.ts"

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

const repo = (extra: Partial<RepoNode> = {}): RepoNode => ({
  nameWithOwner: "acme/api",
  isFork: false,
  owner: { login: "acme", __typename: "Organization" },
  ...extra,
})

test("la liste des repos écarte les forks d'autres utilisateurs et les nœuds null", () => {
  const nodes = [
    repo(),
    null,
    repo({
      nameWithOwner: "bob/api",
      isFork: true,
      owner: { login: "bob", __typename: "User" },
    }),
    repo({
      nameWithOwner: "me/api",
      isFork: true,
      owner: { login: "me", __typename: "User" },
    }),
    repo({ nameWithOwner: "globex/api", isFork: true }),
    repo({
      nameWithOwner: "bob/tool",
      owner: { login: "bob", __typename: "User" },
    }),
  ]
  assert.deepEqual(restRepos(nodes, "me"), [
    "acme/api",
    "me/api",
    "globex/api",
    "bob/tool",
  ])
})
