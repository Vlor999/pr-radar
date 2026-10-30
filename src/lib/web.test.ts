import assert from "node:assert/strict"
import { test } from "node:test"

import type { WebStatus } from "./types.ts"
import { openWeb, startErrorText, toggleWeb, WEB_ERRORS } from "./web.ts"

const status = (over: Partial<WebStatus> = {}): WebStatus => ({
  enabled: false,
  port: 14200,
  running: false,
  error: null,
  ...over,
})

/** Faux `invoke` : journal des commandes, réponses de `web_status` et `web_configure` fournies. */
function fake(current: WebStatus, configured: WebStatus) {
  const calls: [string, Record<string, unknown> | undefined][] = []
  const call = async <T>(cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args])
    if (cmd === "web_status") return current as T
    if (cmd === "web_configure") return configured as T
    return undefined as T
  }
  return { calls, call }
}

test("serveur actif : ouvert directement, sans reconfiguration", async () => {
  const { calls, call } = fake(
    status({ enabled: true, running: true }),
    status(),
  )

  await openWeb(call)

  assert.deepEqual(
    calls.map(([cmd]) => cmd),
    ["web_status", "web_open"],
  )
})

test("version web désactivée : activée avec le port enregistré, puis ouverte", async () => {
  const { calls, call } = fake(
    status({ port: 15000 }),
    status({ enabled: true, port: 15000, running: true }),
  )

  const result = await openWeb(call)

  assert.deepEqual(calls, [
    ["web_status", undefined],
    ["web_configure", { enabled: true, port: 15000 }],
    ["web_open", undefined],
  ])
  assert.equal(result.running, true)
})

test("port déjà pris : rien n'est ouvert, l'erreur est dans le statut", async () => {
  const { calls, call } = fake(
    status(),
    status({ enabled: true, error: "port-busy" }),
  )

  const result = await openWeb(call)

  assert.ok(!calls.some(([cmd]) => cmd === "web_open"))
  assert.equal(result.error, "port-busy")
})

test("port pris : message avec le numéro du port", () => {
  assert.equal(
    startErrorText(WEB_ERRORS.en, status({ port: 14200, error: "port-busy" })),
    WEB_ERRORS.en.portBusy(14200),
  )
})

test("autre erreur de démarrage : message du système repris", () => {
  assert.equal(
    startErrorText(WEB_ERRORS.en, status({ error: "permission denied" })),
    "Could not start the server: permission denied",
  )
})

test("sans erreur : aucun message", () => {
  assert.equal(startErrorText(WEB_ERRORS.en, status()), null)
})

test("bulle, serveur actif : arrêté en gardant le port", async () => {
  const { calls, call } = fake(
    status({ enabled: true, port: 15000, running: true }),
    status({ port: 15000 }),
  )

  const result = await toggleWeb(call)

  assert.deepEqual(calls.at(-1), [
    "web_configure",
    { enabled: false, port: 15000 },
  ])
  assert.equal(result.running, false)
})

test("bulle, serveur arrêté : démarré avec le port enregistré, sans ouvrir le navigateur", async () => {
  const { calls, call } = fake(
    status({ port: 15000 }),
    status({ enabled: true, port: 15000, running: true }),
  )

  await toggleWeb(call)

  assert.deepEqual(calls, [
    ["web_status", undefined],
    ["web_configure", { enabled: true, port: 15000 }],
  ])
})
