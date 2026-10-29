import assert from "node:assert/strict"
import { test } from "node:test"

import {
  fromProxyResponse,
  isWeb,
  ticketFromHash,
  toProxyRequest,
} from "./platform.ts"

test("hors navigateur (pas de window), l'app n'est pas en version web", () => {
  assert.equal(isWeb, false)
})

test("le ticket est lu dans le fragment du lien ouvert par l'app", () => {
  assert.equal(ticketFromHash("#k=abc123"), "abc123")
})

test("sans ticket dans le fragment, rien n'est échangé", () => {
  assert.equal(ticketFromHash(""), null)
  assert.equal(ticketFromHash("#other=1"), null)
})

test("la requête transmise garde méthode, en-têtes et corps texte", () => {
  const req = toProxyRequest("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: "{}",
  })
  assert.deepEqual(req, {
    url: "https://api.github.com/graphql",
    method: "POST",
    headers: [
      ["authorization", "Bearer t"],
      ["content-type", "application/json"],
    ],
    body: "{}",
  })
})

test("une requête sans options est un GET sans corps", () => {
  assert.deepEqual(toProxyRequest("https://api.github.com/rate_limit"), {
    url: "https://api.github.com/rate_limit",
    method: "GET",
    headers: [],
  })
})

test("un corps non texte est refusé", () => {
  assert.throws(() =>
    toProxyRequest("https://slack.com/api/users.info", {
      method: "POST",
      body: new Blob(["x"]),
    }),
  )
})

test("la réponse reconstruite garde statut, en-têtes et corps", async () => {
  const res = fromProxyResponse({
    status: 401,
    headers: [["retry-after", "30"]],
    body: '{"ok":false}',
  })
  assert.equal(res.status, 401)
  assert.equal(res.headers.get("Retry-After"), "30")
  assert.deepEqual(await res.json(), { ok: false })
})

test("une réponse 204 n'a pas de corps", async () => {
  const res = fromProxyResponse({ status: 204, headers: [], body: "" })
  assert.equal(res.status, 204)
  assert.equal(await res.text(), "")
})
