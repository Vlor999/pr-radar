import assert from "node:assert/strict"
import { test } from "node:test"

import {
  AUTO_DEFAULT_MS,
  AUTO_MAX_MS,
  autoIntervalMs,
  getAutoInterval,
  measureCost,
  recordRateLimits,
  trackQuota,
  validQuota,
  type Quota,
} from "./quota.ts"

const NOW = 1_000_000_000
const MIN = 60_000
const q = (over: Partial<Quota> = {}): Quota => ({
  limit: 5000,
  remaining: 3000,
  resetAt: NOW + 40 * MIN,
  ...over,
})

test("cas nominal : coût × temps restant / budget au-dessus de la réserve", () => {
  // budget = 3000 - 1000 = 2000 points, 100 points par actualisation sur 40 min → 2 min
  assert.equal(autoIntervalMs([{ quota: q(), cost: 100 }], NOW), 2 * MIN)
})

test("budget épuisé (sous la réserve) : attendre la fin de la fenêtre, 15 min au plus", () => {
  const low = q({ remaining: 900, resetAt: NOW + 10 * MIN })
  assert.equal(autoIntervalMs([{ quota: low, cost: 100 }], NOW), 10 * MIN)
  assert.equal(
    autoIntervalMs([{ quota: q({ remaining: 900 }), cost: 100 }], NOW),
    AUTO_MAX_MS,
  )
})

test("fenêtre réinitialisée pendant l'actualisation : le coût précédent est gardé", () => {
  const prev = q({ remaining: 200 })
  const now = q({ remaining: 4900, resetAt: NOW + 60 * MIN })
  assert.equal(measureCost(prev, now, 80), 80)
})

test("coût nul ou négatif (réponses du cache) : le coût précédent est gardé", () => {
  assert.equal(measureCost(q(), q(), 80), 80)
  assert.equal(measureCost(q(), q({ remaining: 3010 }), 80), 80)
  assert.equal(measureCost(q(), q({ remaining: 2950 }), 80), 50)
})

test("plusieurs comptes : l'intervalle le plus long l'emporte", () => {
  const ms = autoIntervalMs(
    [
      { quota: q(), cost: 100 }, // 2 min
      { quota: q(), cost: 300 }, // 6 min
    ],
    NOW,
  )
  assert.equal(ms, 6 * MIN)
})

test("coût encore inconnu : 5 min", () => {
  assert.equal(measureCost(undefined, q(), undefined), undefined)
  assert.equal(autoIntervalMs([{ quota: q() }], NOW), AUTO_DEFAULT_MS)
  assert.equal(AUTO_DEFAULT_MS, 5 * MIN)
})

test("quota incomplet ou non numérique : refusé", () => {
  assert.equal(validQuota(q()), true)
  assert.equal(validQuota(q({ limit: 0 })), false)
  assert.equal(validQuota(q({ remaining: NaN })), false)
  assert.equal(validQuota(q({ resetAt: NaN })), false)
})

test("coût non numérique : 5 min, jamais NaN", () => {
  assert.equal(
    autoIntervalMs([{ quota: q(), cost: NaN }], NOW),
    AUTO_DEFAULT_MS,
  )
})

const headers = (remaining: string, reset: string) =>
  new Headers({
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": remaining,
    "x-ratelimit-reset": reset,
  })

test("relevé /rate_limit absent : le quota des en-têtes sert de relevé", () => {
  const reset = String(Math.floor(Date.now() / 1000) + 38 * 60)
  trackQuota(headers("2900", reset), "repli")
  recordRateLimits([["repli", null]])
  assert.equal(getAutoInterval(), AUTO_DEFAULT_MS) // premier relevé : coût inconnu
  trackQuota(headers("1900", reset), "repli")
  recordRateLimits([["repli", null]])
  // 1000 points par actualisation, 900 de budget : borné à 15 min
  assert.equal(getAutoInterval(), AUTO_MAX_MS)
})

test("en-tête non numérique ignoré : l'intervalle courant est gardé", () => {
  const before = getAutoInterval()
  trackQuota(headers("abc", "123"), "invalide")
  recordRateLimits([["invalide", null]])
  assert.equal(getAutoInterval(), before)
})
