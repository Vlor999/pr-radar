import assert from "node:assert/strict"
import { test } from "node:test"

import {
  AUTO_DEFAULT_MS,
  AUTO_MAX_MS,
  autoIntervalMs,
  measureCost,
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
