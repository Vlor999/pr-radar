import { useSyncExternalStore } from "react"

import { locale, pick, strings } from "./i18n.ts" // extension : chargé aussi par node --test

const S = strings(
  {
    lowTitle: "Quota GitHub presque épuisé",
    lowBody: (remaining: number, limit: number, reset: string) =>
      `${remaining} / ${limit} points restants, réinitialisé à ${reset}`,
  },
  {
    lowTitle: "GitHub quota almost used up",
    lowBody: (remaining: number, limit: number, reset: string) =>
      `${remaining} / ${limit} points left, resets at ${reset}`,
  },
)

/** Quota GraphQL de GitHub (points par heure), lu dans les en-têtes de chaque réponse. */
export type Quota = { remaining: number; limit: number; resetAt: number }

export const LOW = 0.1 // notification sous 10 % restants, une fois par fenêtre
// mode « auto » : finir chaque fenêtre horaire GitHub avec au moins 20 % du quota
export const RESERVE = 0.2
export const AUTO_MIN_MS = 60_000
export const AUTO_MAX_MS = 15 * 60_000
export const AUTO_DEFAULT_MS = 5 * 60_000 // coût d'une actualisation encore inconnu

const quotas = new Map<string, Quota>() // par compte, d'après les en-têtes
const warned = new Map<string, number>() // fenêtre déjà notifiée, par compte
const spent = new Map<string, number>() // points cumulés renvoyés par `rateLimit { cost }`, par compte
// comptes mesurés → points de leur dernière actualisation mesurée (undefined : encore inconnu)
const costs = new Map<string, number | undefined>()
let worst: Quota | null = null
let autoMs = AUTO_DEFAULT_MS
// notification du quota bas, branchée par l'app (main.tsx) : Tauri reste hors de ce module testé par node --test
let notifyLow: (title: string, body: string) => void = () => {}
export const setLowQuotaNotifier = (fn: typeof notifyLow) => {
  notifyLow = fn
}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const resetTime = (at: number) =>
  new Date(at).toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  })

/** Quota utilisable : nombres finis et limite non nulle (réponse GitHub incomplète sinon). */
export const validQuota = (q: Quota) =>
  Number.isFinite(q.limit) &&
  q.limit > 0 &&
  Number.isFinite(q.remaining) &&
  Number.isFinite(q.resetAt)

// le compte le plus contraint (plus petite part restante) est celui affiché
function updateWorst() {
  worst = [...quotas.values()].reduce<Quota | null>(
    (a, b) => (!a || b.remaining / b.limit < a.remaining / a.limit ? b : a),
    null,
  )
  emit()
}

// intervalle auto recalculé sur les comptes mesurés, quota des en-têtes (5 min s'il n'y en a plus)
function updateAuto(now: number) {
  const next = autoIntervalMs(
    [...costs].flatMap(([id, cost]) => {
      const quota = quotas.get(id)
      return quota ? [{ quota, cost }] : []
    }),
    now,
  )
  if (next === autoMs) return
  autoMs = next
  emit()
}

/** Compte déconnecté : son quota n'est plus affiché ni pris en compte. */
export function forgetQuota(account: string, now = Date.now()) {
  for (const m of [quotas, warned, spent, costs]) m.delete(account)
  updateWorst()
  updateAuto(now)
}

export const getQuota = () => worst

/** Ajoute le `rateLimit { cost }` d'une réponse GraphQL au compteur du compte. */
export const addCost = (account: string, cost: number) => {
  spent.set(account, (spent.get(account) ?? 0) + cost)
}

/** Points GraphQL cumulés du compte depuis le lancement. */
export const spentBy = (account: string) => spent.get(account) ?? 0

export function trackQuota(h: Headers, account: string) {
  const quota = {
    limit: Number(h.get("x-ratelimit-limit")),
    remaining: Number(h.get("x-ratelimit-remaining")),
    resetAt: Number(h.get("x-ratelimit-reset")) * 1000,
  }
  if (!validQuota(quota)) return
  const { limit } = quota
  quotas.set(account, quota)
  updateWorst()
  if (quota.remaining > limit * LOW || warned.get(account) === quota.resetAt)
    return
  warned.set(account, quota.resetAt)
  const t = pick(S)
  notifyLow(
    t.lowTitle,
    t.lowBody(quota.remaining, limit, resetTime(quota.resetAt)),
  )
}

/** Coût d'une actualisation : écart du compteur ; garde l'ancien si rien n'a été consommé (cache, coût absent). */
export const measureCost = (
  before: number,
  after: number,
  cost: number | undefined,
) => {
  const used = after - before
  return used > 0 ? used : cost
}

/** Intervalle du mode auto : le plus long des comptes, pour garder `RESERVE` du quota en fin de fenêtre. */
export function autoIntervalMs(
  accounts: { quota: Quota; cost?: number }[],
  now: number,
): number {
  if (!accounts.length) return AUTO_DEFAULT_MS
  return Math.max(
    ...accounts.map(({ quota, cost }) => {
      if (cost === undefined) return AUTO_DEFAULT_MS
      const left = quota.resetAt - now
      const budget = quota.remaining - RESERVE * quota.limit
      const ms = budget <= 0 ? left : (cost * left) / budget
      if (Number.isNaN(ms)) return AUTO_DEFAULT_MS
      // plancher aussi quand la fenêtre est finie (reset passé) : pas de boucle d'actualisations
      return Math.min(Math.max(ms, AUTO_MIN_MS), AUTO_MAX_MS)
    }),
  )
}

/** Fin d'une actualisation mesurée : coût par compte d'après son compteur avant (`spentBy`), pour le journal. */
export function recordCosts(
  before: (readonly [account: string, spent: number])[],
  now = Date.now(),
) {
  const measured = before.map(([account, from]) => {
    const cost = measureCost(from, spentBy(account), costs.get(account))
    costs.set(account, cost)
    return { account, remaining: quotas.get(account)?.remaining, cost }
  })
  if (measured.length) updateAuto(now)
  return measured
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export const useQuota = (): Quota | null =>
  useSyncExternalStore(subscribe, getQuota)

export const getAutoInterval = () => autoMs

/** Intervalle courant du mode auto (ms), recalculé après chaque actualisation. */
export const useAutoInterval = () =>
  useSyncExternalStore(subscribe, getAutoInterval)
