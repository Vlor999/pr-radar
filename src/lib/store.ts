import { useSyncExternalStore } from "react"

import { fetchMerged, fetchPrs, listRepos, reposWithMyOpenPrs } from "./github"
import { getSettings } from "./settings"
import { buildTree } from "./tree"
import type { MergedPr, Pr, RepoTree } from "./types"

/* ---------- Repos suivis : gardés dans la fenêtre de l'app (localStorage) ---------- */

const REPOS_KEY = "pr-radar:repos"

export function getRepos(): string[] | null {
  try {
    const raw = localStorage.getItem(REPOS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}

export function setRepos(repos: string[]) {
  try {
    localStorage.setItem(REPOS_KEY, JSON.stringify(repos))
  } catch {}
}

/* ---------- Données affichées : chargées depuis GitHub, partagées par toute l'interface ---------- */

const day = (d: Date) => d.toISOString().slice(0, 10)

export type Data = {
  prs: Pr[]
  trees: RepoTree[]
  withPrs: string[]
  fetchedAt: string
  loading: boolean
  error?: string
  /** erreur de jeton : l'interface propose de se reconnecter */
  authError?: boolean
}

let data: Data = {
  prs: [],
  trees: [],
  withPrs: [],
  fetchedAt: "",
  loading: true,
}
const listeners = new Set<() => void>()
let seq = 0

function set(next: Data) {
  data = next
  listeners.forEach((l) => l())
}

export function useData(): Data {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => data,
  )
}

/** (Re)charge tout depuis GitHub. Les réponses d'un chargement dépassé sont ignorées. */
export async function reload() {
  const id = ++seq
  set({ ...data, loading: true })
  listRepos().catch(() => {}) // préchauffe la liste du panneau des repos (~10 s)
  try {
    const withPrs = await reposWithMyOpenPrs().catch(() => [] as string[])
    let repos = getRepos()
    if (!repos) {
      // premier lancement : on suit d'office les repos où j'ai des PR ouvertes
      repos = withPrs
      setRepos(repos)
    }
    const now = new Date()
    const [prs, recent] = await Promise.all([
      fetchPrs(repos),
      fetchMerged(
        repos,
        day(new Date(now.getTime() - getSettings().mergedDays * 86_400_000)),
        day(now),
      ).catch(() => [] as MergedPr[]),
    ])
    if (id !== seq) return
    set({
      prs,
      withPrs,
      trees: repos.map((repo) => ({
        repo,
        roots: buildTree(prs.filter((p) => p.repo === repo)),
        merged: recent.filter((p) => p.repo === repo),
      })),
      fetchedAt: now.toISOString(),
      loading: false,
    })
  } catch (e) {
    if (id !== seq) return
    set({
      ...data,
      loading: false,
      error: e instanceof Error ? e.message.slice(0, 300) : String(e),
      authError: e instanceof Error && e.name === "AuthError",
    })
  }
}
