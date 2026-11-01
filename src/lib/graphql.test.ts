import assert from "node:assert/strict"
import { test } from "node:test"

import {
  gqlFailed,
  gqlMessage,
  restRepos,
  takeCost,
  withCost,
  type GqlResponse,
  type RepoNode,
} from "./graphql.ts"

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

test("query abrégée `{ … }` : rateLimit { cost } ajouté à la racine", () => {
  assert.equal(
    withCost("{ viewer { login } }"),
    "{ rateLimit { cost } viewer { login } }",
  )
})

test("query avec en-tête de variables : ajouté après l'en-tête", () => {
  assert.equal(
    withCost(
      "\nquery($q: String!, $after: String) {\n  search(query: $q) { x }\n}",
    ),
    "\nquery($q: String!, $after: String) { rateLimit { cost }\n  search(query: $q) { x }\n}",
  )
})

test("query nommée : ajouté à la racine", () => {
  assert.equal(
    withCost("query Repos { viewer { id } }"),
    "query Repos { rateLimit { cost } viewer { id } }",
  )
})

test("mutation : inchangée (rateLimit n'existe que sur Query)", () => {
  const m =
    "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }"
  assert.equal(withCost(m), m)
})

test("coût lu puis retiré de data", () => {
  const json: GqlResponse = { data: { rateLimit: { cost: 3 }, viewer: {} } }
  assert.equal(takeCost(json), 3)
  assert.deepEqual(json.data, { viewer: {} })
})

test("rateLimit null (GHES sans limite) : coût inconnu, réponse partielle gardée", () => {
  const json: GqlResponse = {
    data: { rateLimit: null, search: { nodes: [null] } },
    errors,
  }
  assert.equal(takeCost(json), undefined)
  assert.equal(gqlFailed(json), false)
})

test("rateLimit absent (mutation) : coût inconnu, data intacte", () => {
  const json: GqlResponse = { data: { resolveReviewThread: { thread: {} } } }
  assert.equal(takeCost(json), undefined)
  assert.deepEqual(json.data, { resolveReviewThread: { thread: {} } })
})
