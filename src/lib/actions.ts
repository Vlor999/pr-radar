/**
 * Actions de l'interface (ex-server actions de la version web) : mêmes noms, mêmes retours,
 * exécutées ici dans l'app, puis rechargement des données.
 */
import { splitKey } from "./accounts"
import { allAccounts, logout } from "./auth"
import {
  clearCache,
  commentOnPr,
  reposWithMyOpenPrs,
  fetchMerged,
  listRepos,
  replyToThread,
  requestReviewer,
  resolveRepo,
} from "./github"
import { forgetQuota } from "./quota"
import { getRepos, reload, setRepos } from "./store"
import { pull } from "./sync"
import type { MergedPr } from "./types"

const message = (e: unknown) =>
  e instanceof Error ? e.message.slice(0, 300) : String(e)

/** Liste des repos suivis relue avant d'être réécrite en entier (l'autre fenêtre a pu la changer). */
const freshRepos = async () => {
  await pull().catch(() => {})
  return getRepos() ?? []
}

export async function addRepo(repo: string): Promise<{ error?: string }> {
  try {
    const name = await resolveRepo(repo.trim())
    const repos = await freshRepos()
    if (!repos.some((r) => r.toLowerCase() === name.toLowerCase()))
      setRepos([...repos, name])
  } catch (e) {
    return { error: message(e) }
  }
  await reload()
  return {}
}

export async function removeRepo(repo: string) {
  setRepos((await freshRepos()).filter((r) => r !== repo))
  await reload()
}

/** Case du panneau des repos : suit ou arrête de suivre un repo. */
export async function setFollowed(repo: string, followed: boolean) {
  if (followed && !(await listRepos()).includes(repo)) await resolveRepo(repo)
  const repos = (await freshRepos()).filter(
    (r) => r.toLowerCase() !== repo.toLowerCase(),
  )
  setRepos(followed ? [...repos, repo] : repos)
  await reload()
}

export async function accessibleRepos(): Promise<{
  repos: string[]
  error?: string
}> {
  try {
    return { repos: await listRepos() }
  } catch (e) {
    return { repos: [], error: message(e) }
  }
}

/** Bouton Rafraîchir et actualisation automatique : ignore le cache et relit GitHub. */
export async function refreshPrs() {
  // réglages et repos suivis changés dans l'autre fenêtre (app ou version web)
  await pull().catch(() => {})
  clearCache()
  await reload({ measure: true })
}

/** Publie un message sur le nœud GitHub `id`, puis relit GitHub pour l'afficher. */
async function post(
  id: string,
  body: string,
  send: (text: string) => Promise<void>,
): Promise<{ error?: string }> {
  const text = body.trim()
  if (!/^[\w=-]+$/.test(id)) return { error: "Identifiant GitHub invalide" }
  if (!text) return { error: "Message vide" }
  if (text.length > 65_000) return { error: "Message trop long" }
  try {
    await send(text)
  } catch (e) {
    return { error: message(e) }
  }
  clearCache()
  await reload()
  return {}
}

/** Répond dans un fil de discussion de review. */
export const reply = (threadId: string, body: string, repo: string) =>
  post(threadId, body, (text) => replyToThread(threadId, text, repo))

/** Commentaire général sur la PR (une review ne se répond pas individuellement sur GitHub). */
export const comment = (prId: string, body: string, repo: string) =>
  post(prId, body, (text) => commentOnPr(prId, text, repo))

/** Compte ajouté dans les réglages : on suit d'office ses repos où j'ai des PR ouvertes. */
export async function accountAdded(id: string) {
  clearCache({ all: true })
  if (getRepos()) {
    const mine = await reposWithMyOpenPrs().catch(() => [] as string[])
    const repos = await freshRepos()
    setRepos([
      ...new Set([...repos, ...mine.filter((k) => splitKey(k).account === id)]),
    ])
  }
  await reload()
}

/** Déconnecte un compte ; ses repos suivis sont gardés pour une reconnexion. */
export async function signOut(id: string) {
  await logout(id)
  forgetQuota(id)
  clearCache({ all: true })
  if (allAccounts().length) await reload()
}

/** Calendrier : mes PR mergées sur une période (YYYY-MM-DD inclus), repos suivis. */
export async function mergedBetween(
  from: string,
  to: string,
): Promise<{ prs: MergedPr[]; error?: string }> {
  const date = /^\d{4}-\d{2}-\d{2}$/
  if (!date.test(from) || !date.test(to))
    return { prs: [], error: "Dates invalides" }
  try {
    return { prs: await fetchMerged(getRepos() ?? [], from, to) }
  } catch (e) {
    return { prs: [], error: message(e) }
  }
}

/** Demande une review sur une de mes PR, puis relit GitHub pour afficher la demande. */
export async function addReviewer(
  prId: string,
  userId: string,
  repo: string,
): Promise<{ error?: string }> {
  try {
    await requestReviewer(prId, userId, repo)
  } catch (e) {
    return { error: message(e) }
  }
  clearCache()
  await reload()
  return {}
}
