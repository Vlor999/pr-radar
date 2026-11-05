/**
 * Actions de l'interface (ex-server actions de la version web) : mêmes noms, mêmes retours,
 * exécutées ici dans l'app, puis rechargement des données.
 */
import { describeErrors, splitKey } from "./accounts"
import { allAccounts, logout } from "./auth"
import {
  clearCache,
  commentOnPr,
  reposWithMyOpenPrs,
  fetchMerged,
  fetchTimeline,
  listRepos,
  markReady,
  replyToThread,
  requestReviewer,
  rerunFailedJobs,
  resolveRepo,
  resolveThread,
  updateBranch,
} from "./github"
import { pick, strings } from "./i18n"
import { log } from "./log"
import { prNumberOf } from "./log-data"
import { forgetQuota } from "./quota"
import {
  addPending,
  dropPending,
  getData,
  getRepos,
  markSent,
  reload,
  setRepos,
} from "./store"
import { pull } from "./sync"
import { exceptMineFor, localDay } from "./timeline"
import type { MergedPr, TimelinePr } from "./types"

const S = strings(
  {
    truncated:
      "Plus de 1 000 PR sur un lot de repos : la liste est incomplète, réduis la période",
  },
  {
    truncated:
      "More than 1,000 PRs in a batch of repos: the list is incomplete, shorten the period",
  },
)

/** message d'erreur affiché tel quel dans l'interface, tronqué au-delà */
const MAX_ERROR_CHARS = 300
/** GitHub refuse un corps de commentaire de plus de 65 536 caractères (limite gardée sous ce plafond) */
const MAX_COMMENT_CHARS = 65_000

const message = (e: unknown) =>
  e instanceof Error ? e.message.slice(0, MAX_ERROR_CHARS) : String(e)

/** Journal local : action, repo, numéro de la PR (d'après le nœud GraphQL), issue ; jamais le texte envoyé. */
const logAction = (
  action: string,
  repo: string,
  error?: string,
  extra?: Record<string, unknown>,
) =>
  log(error ? "warn" : "info", "action", {
    action,
    repo,
    ok: !error,
    ...extra,
    ...(error && { error }),
  })

const prOf = (id: string) => ({ pr: prNumberOf(getData().prs, id) })

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
    logAction("addRepo", repo, message(e))
    return { error: message(e) }
  }
  logAction("addRepo", repo)
  await reload()
  return {}
}

export async function removeRepo(repo: string) {
  setRepos((await freshRepos()).filter((r) => r !== repo))
  logAction("removeRepo", repo)
  await reload()
}

/** Case du panneau des repos : suit ou arrête de suivre un repo. */
export async function setFollowed(repo: string, followed: boolean) {
  if (followed && !(await listRepos()).includes(repo)) await resolveRepo(repo)
  const repos = (await freshRepos()).filter(
    (r) => r.toLowerCase() !== repo.toLowerCase(),
  )
  setRepos(followed ? [...repos, repo] : repos)
  logAction(followed ? "followRepo" : "unfollowRepo", repo)
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

/**
 * Bouton Rafraîchir et actualisation automatique : ignore le cache et relit GitHub.
 * `auto` (minuterie, retour sur la fenêtre) : seules les PR changées sont relues en entier ; manuelle : tout.
 */
export async function refreshPrs({ auto = false } = {}) {
  // réglages et repos suivis changés dans l'autre fenêtre (app ou version web)
  await pull().catch(() => {})
  clearCache()
  await reload({ measure: true, delta: auto, track: true })
}

/** Publie un message sur le nœud GitHub `id`, puis relit GitHub pour l'afficher. */
async function post(
  action: string,
  repo: string,
  id: string,
  body: string,
  send: (text: string) => Promise<void>,
): Promise<{ error?: string }> {
  const text = body.trim()
  if (!/^[\w=-]+$/.test(id)) return { error: "Identifiant GitHub invalide" }
  if (!text) return { error: "Message vide" }
  if (text.length > MAX_COMMENT_CHARS) return { error: "Message trop long" }
  try {
    await send(text)
  } catch (e) {
    logAction(action, repo, message(e), prOf(id))
    return { error: message(e) }
  }
  logAction(action, repo, undefined, prOf(id))
  clearCache()
  await reload()
  return {}
}

/** Répond dans un fil de discussion de review. */
export const reply = (threadId: string, body: string, repo: string) =>
  post("reply", repo, threadId, body, (text) =>
    replyToThread(threadId, text, repo),
  )

/** Commentaire général sur la PR (une review ne se répond pas individuellement sur GitHub). */
export const comment = (prId: string, body: string, repo: string) =>
  post("comment", repo, prId, body, (text) => commentOnPr(prId, text, repo))

/** Écrit sur le nœud GitHub `id` (fil, PR), puis relit GitHub pour afficher le résultat.
 * `settle` : attendu entre le succès et la relecture (animation de sortie de l'élément). */
async function act(
  action: string,
  repo: string,
  id: string,
  send: () => Promise<void>,
  settle?: () => Promise<void>,
  extra: Record<string, unknown> = prOf(id),
): Promise<{ error?: string }> {
  if (!/^[\w=-]+$/.test(id)) return { error: "Identifiant GitHub invalide" }
  try {
    await send()
  } catch (e) {
    logAction(action, repo, message(e), extra)
    return { error: message(e) }
  }
  logAction(action, repo, undefined, extra)
  await settle?.()
  clearCache()
  await reload()
  return {}
}

/** Résout un fil de review : il quitte la liste des fils non résolus au rechargement. */
export const resolve = (
  threadId: string,
  repo: string,
  settle?: () => Promise<void>,
) => act("resolve", repo, threadId, () => resolveThread(threadId, repo), settle)

/** Sort une de mes PR du mode draft. */
export const ready = (
  prId: string,
  repo: string,
  settle?: () => Promise<void>,
) => act("ready", repo, prId, () => markReady(prId, repo), settle)

/** Merge la base dans la branche de la PR, en retard sur sa base. */
export const syncBranch = (
  prId: string,
  repo: string,
  settle?: () => Promise<void>,
) => act("syncBranch", repo, prId, () => updateBranch(prId, repo), settle)

/** Relance les jobs en échec d'un workflow run de la PR ; la vue CI se relit avec la PR. */
export const rerunFailed = (
  repo: string,
  runId: number,
  settle?: () => Promise<void>,
) =>
  act(
    "rerunFailed",
    repo,
    String(runId),
    () => rerunFailedJobs(repo, runId),
    settle,
    { runId },
  )

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

/**
 * Vue Fil, lecture légère : PR des repos suivis sur une période (YYYY-MM-DD inclus), les miennes et celles des
 * autres ; sur la fenêtre d'aujourd'hui, mes PR ouvertes sont laissées à l'arbre (`exceptMineFor`).
 */
export async function timelineBetween(
  from: string,
  to: string,
): Promise<{ prs: TimelinePr[]; error?: string }> {
  const date = /^\d{4}-\d{2}-\d{2}$/
  if (!date.test(from) || !date.test(to))
    return { prs: [], error: "Dates invalides" }
  try {
    const d = getData()
    const { data, errors, truncated } = await fetchTimeline(
      getRepos() ?? [],
      from,
      to,
      {
        exceptMine: exceptMineFor(
          to,
          localDay(new Date()),
          !!d.fetchedAt && !d.error,
        ),
      },
    )
    const notes = [
      ...(errors.length ? [describeErrors(errors)] : []),
      ...(truncated ? [pick(S).truncated] : []),
    ]
    return { prs: data, ...(notes.length && { error: notes.join(" ; ") }) }
  } catch (e) {
    return { prs: [], error: message(e) }
  }
}

/**
 * Demande une review sur une de mes PR, sans attendre GitHub : le reviewer s'affiche tout de suite sur la
 * carte (`addPending`), la mutation et la relecture suivent en arrière-plan. Refus : il disparaît, l'erreur
 * s'affiche sur la carte.
 */
export function addReviewer(
  prId: string,
  user: { id: string; login: string },
  pr: { repo: string; url: string },
) {
  addPending(pr.url, user.login)
  void (async () => {
    try {
      await requestReviewer(prId, user.id, pr.repo)
    } catch (e) {
      logAction("addReviewer", pr.repo, message(e), prOf(prId))
      dropPending(pr.url, user.login, message(e))
      return
    }
    logAction("addReviewer", pr.repo, undefined, prOf(prId))
    markSent(pr.url, user.login)
    clearCache()
    await reload()
  })()
}
