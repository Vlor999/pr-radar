
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"

import type { Pr } from "@/lib/types"

/**
 * « Nouveau depuis ta dernière visite » : on garde, par PR, la date de dernière activité déjà vue.
 * Une PR est nouvelle si elle n'a jamais été vue ou a bougé depuis. Stocké dans le navigateur.
 */
const KEY = "pr-seen"
const listeners = new Set<() => void>()

const read = () => {
  try {
    return localStorage.getItem(KEY) ?? ""
  } catch {
    return ""
  }
}

function write(seen: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen))
  } catch {}
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const prKey = (p: Pr) => `${p.repo}#${p.number}`

export function useSeen(prs: Pr[]) {
  // null côté serveur (aucun badge au premier rendu), "" à la toute première visite
  const raw = useSyncExternalStore(subscribe, read, () => null)
  const seen = useMemo<Record<string, string> | null>(
    () => (raw ? JSON.parse(raw) : null),
    [raw]
  )

  // première visite : tout ce qui est là est considéré comme vu, pas de badge partout
  useEffect(() => {
    if (raw === "")
      write(Object.fromEntries(prs.map((p) => [prKey(p), p.updated])))
  }, [raw, prs])

  const isNew = useCallback(
    (p: Pr) => !!seen && seen[prKey(p)] !== p.updated,
    [seen]
  )

  const markSeen = useCallback(
    (ps: Pr[]) => {
      if (!ps.some(isNew)) return
      write({
        ...JSON.parse(read() || "{}"),
        ...Object.fromEntries(ps.map((p) => [prKey(p), p.updated])),
      })
    },
    [isNew]
  )

  return { isNew, markSeen, count: prs.filter(isNew).length }
}
