import assert from "node:assert/strict"
import { test } from "node:test"

import {
  AUTO_DEFAULT_MS,
  AUTO_MAX_MS,
  AUTO_MIN_MS,
  addCost,
  autoIntervalMs,
  forgetQuota,
  getAutoInterval,
  getQuota,
  measureCost,
  recordCosts,
  solveInterval,
  spentBy,
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

test("coût d'une actualisation : écart du compteur de points", () => {
  assert.equal(measureCost(120, 170, 80), 50)
})

test("compteur inchangé ou en baisse (cache, compte reconnecté) : le coût précédent est gardé", () => {
  assert.equal(measureCost(120, 120, 80), 80)
  assert.equal(measureCost(120, 0, 80), 80)
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
  assert.equal(measureCost(0, 0, undefined), undefined)
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

// actualisation mesurée : `points` renvoyés par `rateLimit { cost }`, puis quota des en-têtes
const refresh = (
  account: string,
  points: number,
  remaining: number,
  resetAt?: number,
) => {
  const before = spentBy(account)
  if (points) addCost(account, points)
  trackQuota(headers(remaining, resetAt), account)
  return recordCosts([[account, before]], NOW)
}

test("coût cumulé des requêtes de l'actualisation : base de l'intervalle", () => {
  // 3 requêtes, 400 points ; 1600 de budget, 40 min restantes → 10 min
  const before = spentBy("cumul")
  for (const points of [1, 99, 300]) addCost("cumul", points)
  trackQuota(headers(2600), "cumul")
  assert.deepEqual(recordCosts([["cumul", before]], NOW), [
    { account: "cumul", remaining: 2600, cost: 400 },
  ])
  assert.equal(getAutoInterval(), 10 * MIN)
  forgetQuota("cumul", NOW)
})

test("actualisation servie par le cache (0 point) : le coût précédent est gardé", () => {
  refresh("cache", 400, 2600)
  assert.deepEqual(refresh("cache", 0, 2600), [
    { account: "cache", remaining: 2600, cost: 400 },
  ])
  assert.equal(getAutoInterval(), 10 * MIN)
  forgetQuota("cache", NOW)
})

test("coût absent (GHES sans limite de débit) : inconnu, 5 min", () => {
  assert.deepEqual(refresh("ghes", 0, 2600), [
    { account: "ghes", remaining: 2600, cost: undefined },
  ])
  assert.equal(getAutoInterval(), AUTO_DEFAULT_MS)
  forgetQuota("ghes", NOW)
})

test("compteur propre à chaque compte", () => {
  addCost("a", 30)
  addCost("b", 5)
  addCost("a", 10)
  assert.equal(spentBy("a"), 40)
  assert.equal(spentBy("b"), 5)
  forgetQuota("a", NOW)
  forgetQuota("b", NOW)
  assert.equal(spentBy("a"), 0)
})

test("en-tête non numérique ignoré : l'intervalle courant est gardé", () => {
  refresh("valide", 400, 2600)
  trackQuota(
    new Headers({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "abc",
    }),
    "invalide",
  )
  recordCosts([["invalide", 0]], NOW)
  assert.equal(getAutoInterval(), 10 * MIN)
  forgetQuota("invalide", NOW)
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
  refresh("lent", 400, 2600) // 10 min
  refresh("rapide", 100, 2900, NOW + 38 * MIN) // 100 × 38 min / 1900 = 2 min
  assert.equal(getAutoInterval(), 10 * MIN)
  forgetQuota("lent", NOW)
  assert.equal(getAutoInterval(), 2 * MIN)
  forgetQuota("rapide", NOW)
  assert.equal(getAutoInterval(), AUTO_DEFAULT_MS)
})

test("coût par différence inconnu : chaque actualisation compte comme complète", () => {
  assert.equal(solveInterval(1_000, 100), 100_000)
})

test("coût par différence connu : une relecture complète amortie sur 10 min", () => {
  // 20 points par tick + 100 tous les 10 min, 3000 ms par point : T = 20 × 3000 / (1 − 100 × 3000 / 600000) = 2 min
  assert.equal(solveInterval(3_000, 100, 20), 2 * MIN)
})

test("budget trop serré pour amortir : intervalle au-delà de 10 min, chaque tick relit tout", () => {
  // (2 + 100) × 6000 ms = 10,2 min
  assert.equal(solveInterval(6_000, 100, 2), 612_000)
})

test("tick par différence : son coût rangé à part, l'intervalle n'hérite pas du coût d'un sondage", () => {
  // complète : 400 points, 1600 de budget sur 40 min → 10 min
  refresh("mix", 400, 2600)
  assert.equal(getAutoInterval(), 10 * MIN)
  const before = spentBy("mix")
  addCost("mix", 4)
  trackQuota(headers(2596), "mix")
  recordCosts([["mix", before]], NOW, false)
  // 4 points par tick + 400 par 10 min, budget 1596 : bien au-dessus de AUTO_MIN_MS
  assert.ok(getAutoInterval() > 5 * MIN)
  forgetQuota("mix", NOW)
})
