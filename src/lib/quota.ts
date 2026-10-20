import { useSyncExternalStore } from "react"

import { notify } from "@/hooks/use-pr-notifications"

/** Quota GraphQL de GitHub (points par heure), lu dans les en-têtes de chaque réponse. */
export type Quota = { remaining: number; limit: number; resetAt: number }

export const LOW = 0.1 // notification sous 10 % restants, une fois par fenêtre
let quota: Quota | null = null
let warned = 0
const listeners = new Set<() => void>()

export const resetTime = (at: number) =>
  new Date(at).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })

export function trackQuota(h: Headers) {
  const limit = Number(h.get("x-ratelimit-limit"))
  if (!limit) return
  quota = {
    limit,
    remaining: Number(h.get("x-ratelimit-remaining")),
    resetAt: Number(h.get("x-ratelimit-reset")) * 1000,
  }
  listeners.forEach((l) => l())
  if (quota.remaining > limit * LOW || warned === quota.resetAt) return
  warned = quota.resetAt
  notify(
    "Quota GitHub presque épuisé",
    `${quota.remaining} / ${limit} points restants, réinitialisé à ${resetTime(quota.resetAt)}`,
  ).catch(() => {})
}

export function useQuota(): Quota | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => quota,
  )
}
