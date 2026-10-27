import assert from "node:assert/strict"
import { test } from "node:test"

import {
  AUTO_DEFAULT_MS,
  AUTO_MAX_MS,
  AUTO_MIN_MS,
  autoIntervalMs,
  forgetQuota,
  getAutoInterval,
  getQuota,
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

test("fenêtre déjà réinitialisée (reset passé) : 1 min, pas de boucle à 0 ms", () => {
  const past = q({ resetAt: NOW - MIN })
  assert.equal(autoIntervalMs([{ quota: past, cost: 100 }], NOW), AUTO_MIN_MS)
})

test("résultat très court : 1 min au moins", () => {
  assert.equal(autoIntervalMs([{ quota: q(), cost: 1 }], NOW), AUTO_MIN_MS)
})

test("budget épuisé avec une fin de fenêtre proche : 1 min au moins", () => {
  const low = q({ remaining: 900, resetAt: NOW + 10_000 })
  assert.equal(autoIntervalMs([{ quota: low, cost: 100 }], NOW), AUTO_MIN_MS)
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

// en-têtes GraphQL d'un compte, fenêtre qui se termine à `resetAt` (ms)
const headers = (remaining: number, resetAt = NOW + 40 * MIN) =>
  new Headers({
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(resetAt / 1000),
  })

// deux actualisations relevées par les en-têtes (pas de /rate_limit) : coût = from - to
const measureTwice = (
  account: string,
  from: number,
  to: number,
  resetAt?: number,
) => {
  trackQuota(headers(from, resetAt), account)
  recordRateLimits([[account, null]], NOW)
  trackQuota(headers(to, resetAt), account)
  recordRateLimits([[account, null]], NOW)
}

test("relevé /rate_limit absent : le quota des en-têtes sert de relevé", () => {
  // 400 points par actualisation, 1600 de budget, 40 min restantes → 10 min
  measureTwice("repli", 3000, 2600)
  assert.equal(getAutoInterval(), 10 * MIN)
  forgetQuota("repli", NOW)
})

test("en-tête non numérique ignoré : l'intervalle courant est gardé", () => {
  measureTwice("valide", 3000, 2600)
  trackQuota(
    new Headers({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "abc",
    }),
    "invalide",
  )
  recordRateLimits([["invalide", null]], NOW)
  assert.equal(getAutoInterval(), 10 * MIN)
  forgetQuota("valide", NOW)
})

test("compte déconnecté : son quota n'est plus le plus contraint affiché", () => {
  trackQuota(headers(4000), "garde")
  trackQuota(headers(600), "parti")
  assert.equal(getQuota()?.remaining, 600)
  forgetQuota("parti", NOW)
  assert.equal(getQuota()?.remaining, 4000)
  forgetQuota("garde", NOW)
  assert.equal(getQuota(), null)
})

test("compte déconnecté : l'intervalle auto est recalculé sans lui, 5 min sans compte", () => {
  measureTwice("lent", 3000, 2600) // 10 min
  measureTwice("rapide", 3000, 2900, NOW + 38 * MIN) // 100 × 38 min / 1900 = 2 min
  assert.equal(getAutoInterval(), 10 * MIN)
  forgetQuota("lent", NOW)
  assert.equal(getAutoInterval(), 2 * MIN)
  forgetQuota("rapide", NOW)
  assert.equal(getAutoInterval(), AUTO_DEFAULT_MS)
})
