import { useSyncExternalStore } from "react"

import { describeErrors, splitKey } from "./accounts"
import { findAccount } from "./auth"
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
  /** compte dont le jeton a été refusé */
  authAccount?: string
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
  // préchauffe la liste du panneau des repos (~1,5 Mo), au premier chargement seulement
  if (!data.fetchedAt) listRepos().catch(() => {})
  try {
    const withPrs = await reposWithMyOpenPrs().catch(() => data.withPrs)
    let repos = getRepos()
    if (!repos) {
      // premier lancement : on suit d'office les repos où j'ai des PR ouvertes
      repos = withPrs
      setRepos(repos)
    }
    // repos d'un compte déconnecté : gardés dans la liste, pas affichés
    repos = repos.filter((r) => findAccount(splitKey(r).account))
    const now = new Date()
    const [{ data: prs, errors }, recent] = await Promise.all([
      fetchPrs(repos),
      fetchMerged(
        repos,
        day(new Date(now.getTime() - getSettings().mergedDays * 86_400_000)),
        day(now),
      ).catch(() => [] as MergedPr[]),
    ])
    if (id !== seq) return
    // compte en échec (les autres ont répondu) : ses repos sont masqués, l'erreur le nomme
    const failed = new Set(errors.map((e) => e.account.id))
    set({
      prs,
      withPrs,
      error: errors.length ? describeErrors(errors).slice(0, 300) : undefined,
      trees: repos
        .filter((r) => !failed.has(splitKey(r).account))
        .map((repo) => ({
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
      authAccount: (e as { account?: string }).account,
    })
  }
}
