import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { CHECKS_QUERY } from "./checks.ts"

import {
  gqlFailed,
  gqlMessage,
  restRepos,
  takeCost,
  withCost,
  type GqlResponse,
  type RepoNode,
} from "./graphql.ts"
import { queryFor } from "./pr-query.ts"

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

test("coût négatif, NaN ou non numérique : inconnu, rateLimit retiré", () => {
  for (const cost of [-1, NaN, "3", null]) {
    const json: GqlResponse = { data: { rateLimit: { cost }, viewer: {} } }
    assert.equal(takeCost(json), undefined)
    assert.deepEqual(json.data, { viewer: {} })
  }
})

test("data null (requête refusée) : coût inconnu", () => {
  assert.equal(takeCost({ data: null, errors }), undefined)
})

// requêtes passées à `gql` dans github.ts (module Tauri, non importable ici) : lues dans la source,
// `${CONSTANTE}` remplacé par un nombre comme à l'exécution
const sourceOps = () => {
  const src = readFileSync(new URL("./github.ts", import.meta.url), "utf8")
  const literals = [
    ...[...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]),
    ...[...src.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]),
  ].map((s) => s.replace(/\$\{[^}]*\}/g, "1"))
  // une opération a un corps : `"query"` seul (nom d'argument) n'en est pas une
  const isOp = (kind: RegExp) => (s: string) =>
    kind.test(s.trimStart()) && s.includes("{")
  return {
    queries: literals.filter(isOp(/^(query\b|\{ \w+)/)),
    mutations: literals.filter(isOp(/^mutation\b/)),
  }
}

// `rateLimit { cost }` posé une fois, au premier niveau du corps de l'opération, accolades équilibrées
const assertAtRoot = (op: string) => {
  const out = withCost(op)
  const at = out.indexOf("rateLimit { cost }")
  assert.notEqual(at, -1, op)
  assert.equal(out.indexOf("rateLimit { cost }", at + 1), -1, op)
  const before = out.slice(0, at)
  const depth = (s: string) =>
    [...s].reduce((d, ch) => d + (ch === "{" ? 1 : ch === "}" ? -1 : 0), 0)
  assert.equal(depth(before), 1, op)
  assert.equal(depth(out), 0, op)
  assert.equal(before.split("(").length, before.split(")").length, op)
}

test("chaque requête réelle reçoit rateLimit { cost } à la racine de son corps", () => {
  const { queries } = sourceOps()
  // REVIEW, REPOS, MENTIONS, reviewers, merged, withPrs, recherches, viewer…
  assert.ok(queries.length >= 8, `${queries.length} requêtes trouvées`)
  for (const op of [
    ...queries,
    queryFor("github.com"),
    queryFor("github.com", true),
    queryFor("ghe.example.com"),
    CHECKS_QUERY,
  ])
    assertAtRoot(op)
})

test("chaque mutation réelle est envoyée inchangée", () => {
  const { mutations } = sourceOps()
  assert.ok(mutations.length >= 5, `${mutations.length} mutations trouvées`)
  for (const m of mutations) assert.equal(withCost(m), m)
})
