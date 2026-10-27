import { useSyncExternalStore } from "react"

import { describeErrors, splitKey } from "./accounts"
import { allAccounts, findAccount } from "./auth"
import {
  fetchMerged,
  fetchPrs,
  fetchReviews,
  listRepos,
  rateLimit,
  reposWithMyOpenPrs,
} from "./github"
import { recordRateLimits } from "./quota"
import { mergeReviews, type Reviews } from "./review"
import { getSettings } from "./settings"
import { buildTree, keepVanished } from "./tree"
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
  /** PR des autres qui attendent ma review, tous repos confondus, et comptes lus */
  reviews: Reviews
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
  reviews: { accounts: [], reviews: [] },
  fetchedAt: "",
  loading: true,
}
const listeners = new Set<() => void>()
let seq = 0
let held = new Set<string>() // repos dont les PR sont gardées malgré une recherche vide
let heldReviews = new Set<string>() // comptes dont les reviews sont gardées malgré une recherche vide

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

/**
 * (Re)charge tout depuis GitHub. Les réponses d'un chargement dépassé sont ignorées.
 * `measure` : chargement sans cache (actualisation), son coût en quota sert au mode « auto ».
 */
export async function reload({ measure = false } = {}) {
  const id = ++seq
  set({ ...data, loading: true })
  // préchauffe la liste du panneau des repos (1 requête GraphQL par 100 repos), au premier chargement seulement
  if (!data.fetchedAt) listRepos().catch(() => {})
  try {
    const withPrs = await reposWithMyOpenPrs().catch(() => data.withPrs)
    let repos = getRepos()
    if (!repos) {
      // premier lancement : on suit d'office les repos où j'ai des PR ouvertes
      repos = withPrs
      if (repos.length) setRepos(repos) // vide peut-être à tort : relu au prochain chargement
    }
    // repos d'un compte déconnecté : gardés dans la liste, pas affichés
    repos = repos.filter((r) => findAccount(splitKey(r).account))
    const now = new Date()
    const queried = allAccounts()
    const [{ data: fetched, errors }, recent, found] = await Promise.all([
      fetchPrs(repos),
      fetchMerged(
        repos,
        day(new Date(now.getTime() - getSettings().mergedDays * 86_400_000)),
        day(now),
      ).catch(() => [] as MergedPr[]),
      // tous les comptes en échec : même traitement qu'un échec partiel
      fetchReviews().catch((error: unknown) => ({
        data: [],
        errors: queried.map((account) => ({ account, error })),
      })),
    ])
    if (id !== seq) return
    // compte dont seule la recherche des reviews échoue : nommé lui aussi dans le bandeau
    const shown = [
      ...errors,
      ...found.errors.filter(
        (r) => !errors.some((e) => e.account.id === r.account.id),
      ),
    ]
    // compte en échec (les autres ont répondu) : ses repos sont masqués, l'erreur le nomme
    const failed = new Set(errors.map((e) => e.account.id))
    const live = repos.filter((r) => !failed.has(splitKey(r).account))
    const kept = keepVanished(data.prs, fetched, held, live)
    held = kept.held
    const prs = kept.prs
    const reviews = mergeReviews(
      data.reviews,
      found.data,
      queried.map((a) => a.id),
      found.errors.map((e) => e.account.id),
      heldReviews,
    )
    heldReviews = reviews.held
    set({
      prs,
      withPrs,
      reviews: reviews.known,
      error: shown.length ? describeErrors(shown).slice(0, 300) : undefined,
      trees: live.map((repo) => ({
        repo,
        roots: buildTree(prs.filter((p) => p.repo === repo)),
        merged: recent.filter((p) => p.repo === repo),
      })),
      fetchedAt: now.toISOString(),
      loading: false,
    })
    // relevé du quota de chaque compte, sans faire attendre la fin de l'actualisation : base du mode « auto »
    if (measure && getSettings().refreshMinutes === "auto")
      Promise.all(queried.map(async (a) => [a.id, await rateLimit(a)] as const))
        .then((snaps) => {
          if (id === seq) recordRateLimits(snaps)
        })
        .catch(() => {})
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
