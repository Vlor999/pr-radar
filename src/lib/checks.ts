/** Vue CI d'une PR (workflows, jobs, statuts de commit) : logique pure, sans Tauri. */
import { pick, strings } from "./i18n.ts" // extension : chargé aussi par node --test
import { isExternalHref } from "./links.ts"
import type { CiJob, CiState, CiWorkflow } from "./types.ts"

// Bornes demandées : le coût GraphQL et la limite de 500 000 nœuds par appel suivent les `first`, pas les
// nœuds renvoyés. 1 commit × 20 suites × 50 runs = 1 000 nœuds, 1 point (mesuré : `rateLimit { cost }`).
// Une PR a rarement plus de quelques workflows ; GitHub plafonne une matrice à 256 jobs, au-delà de 50 le
// reste est sur GitHub (lien « Ouvrir sur GitHub » de la carte).
const SUITES_PER_COMMIT = 20
const RUNS_PER_SUITE = 50
// conclusions d'échec d'un check run (`CheckConclusionState`)
const FAILED = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
])

// message de GitHub d'un refus de droit (jeton fine-grained sans Actions, scope manquant), pas d'une limite ou de SSO
const PERMISSION_MESSAGE = /scope|permission|not accessible/i

const S = strings(
  {
    failed: (status: number) => `Relance impossible (HTTP ${status})`,
    sep: " : ",
    tokenHint:
      "le jeton doit avoir le droit d'écriture sur Actions (jeton fine-grained) ou le scope repo",
  },
  {
    failed: (status: number) => `Re-run failed (HTTP ${status})`,
    sep: ": ",
    tokenHint:
      "the token needs write access to Actions (fine-grained token) or the repo scope",
  },
)

/** Requête de la vue CI d'une PR : dernier commit, ses check suites et ses statuts (`contexts` : liste, pas une connexion). */
export const CHECKS_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(last: 1) { nodes { commit {
        checkSuites(first: ${SUITES_PER_COMMIT}) { nodes {
          id
          app { name }
          workflowRun { databaseId event file { path } workflow { name } }
          checkRuns(first: ${RUNS_PER_SUITE}) { nodes { name status conclusion startedAt completedAt detailsUrl } }
        } }
        status { contexts { context state targetUrl createdAt } }
      } } }
    }
  }
}`

type RawRun = {
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  detailsUrl: string | null
}
type RawSuite = {
  id: string
  app: { name: string } | null
  workflowRun: {
    databaseId: number
    event: string
    file: { path: string } | null
    workflow: { name: string } | null
  } | null
  checkRuns: { nodes: RawRun[] }
}
type RawContext = {
  context: string
  state: string
  targetUrl: string | null
  createdAt: string
}
export type RawChecks = {
  repository: {
    pullRequest: {
      commits: {
        nodes: {
          commit: {
            checkSuites: { nodes: (RawSuite | null)[] } | null
            status: { contexts: RawContext[] } | null
          }
        }[]
      }
    } | null
  } | null
}

/** État d'un check run : `status` tant qu'il n'est pas terminé, sinon sa `conclusion`. */
export const runState = (
  status: string,
  conclusion: string | null,
): CiState => {
  if (status === "IN_PROGRESS") return "running"
  if (status !== "COMPLETED") return "queued" // QUEUED, REQUESTED, WAITING, PENDING
  if (conclusion === "SUCCESS") return "success"
  if (conclusion && FAILED.has(conclusion)) return "failure"
  if (conclusion === "CANCELLED") return "cancelled"
  if (conclusion === "SKIPPED") return "skipped"
  return "neutral" // NEUTRAL, STALE
}

/** État d'un statut de commit (`StatusState`). */
export const contextState = (state: string): CiState =>
  state === "SUCCESS"
    ? "success"
    : state === "FAILURE" || state === "ERROR"
      ? "failure"
      : "running" // PENDING, EXPECTED

/** Lien d'un job : https seulement (`targetUrl` d'un statut est libre, posé par n'importe quel outil ;
 * l'opener n'ouvre que `https://`), sinon la ligne n'est pas un lien. */
const openable = (url: string | null) =>
  url && isExternalHref(url) ? url : null

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1)

/** Boîtes de la vue CI : une par check suite qui a des jobs (les apps sans check run, comme GitHub, sont masquées),
 * puis les statuts de commit en dernier. */
export function toCiView(raw: RawChecks): CiWorkflow[] {
  const commit = raw.repository?.pullRequest?.commits.nodes[0]?.commit
  if (!commit) return []
  const suites = (commit.checkSuites?.nodes ?? [])
    .filter((s): s is RawSuite => !!s && s.checkRuns.nodes.length > 0)
    .map((s): CiWorkflow => {
      const run = s.workflowRun
      return {
        key: s.id,
        name: run?.workflow?.name ?? s.app?.name ?? null,
        file: run?.file ? basename(run.file.path) : null,
        event: run?.event ?? null,
        runId: run?.databaseId ?? null,
        jobs: s.checkRuns.nodes.map((r) => ({
          name: r.name,
          state: runState(r.status, r.conclusion),
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          url: openable(r.detailsUrl),
        })),
      }
    })
  const contexts = commit.status?.contexts ?? []
  if (!contexts.length) return suites
  return [
    ...suites,
    {
      key: "statuses",
      name: null,
      file: null,
      event: null,
      runId: null,
      jobs: contexts.map((c): CiJob => ({
        name: c.context,
        state: contextState(c.state),
        startedAt: null, // un statut n'a qu'une date de création : pas de durée
        completedAt: null,
        url: openable(c.targetUrl),
      })),
    },
  ]
}

/** « Relancer les jobs en échec » : un workflow Actions terminé avec au moins un job en échec. */
export const canRerun = (w: CiWorkflow) =>
  w.runId !== null &&
  w.jobs.some((j) => j.state === "failure") &&
  !w.jobs.some((j) => j.state === "running" || j.state === "queued")

/** Durée d'un job en ms ; en cours : jusqu'à `now`. Null sans début (en file, statut de commit). */
export const jobDurationMs = (j: CiJob, now: number): number | null => {
  if (!j.startedAt) return null
  const end = j.completedAt
    ? Date.parse(j.completedAt)
    : j.state === "running"
      ? now
      : null
  return end === null ? null : Math.max(0, end - Date.parse(j.startedAt))
}

/** « 31s », « 1m 31s », « 1h 2m », comme GitHub. */
export const formatDuration = (ms: number) => {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** Message lisible d'un refus de `rerun-failed-jobs` : code HTTP, `message` de GitHub, et l'indication sur le jeton
 * seulement pour un refus de droit (un 403 est aussi une limite secondaire ou le SSO, un 404 un run introuvable). */
export const rerunError = (status: number, message?: string) => {
  const t = pick(S)
  return [
    t.failed(status),
    message,
    message && PERMISSION_MESSAGE.test(message) && t.tokenHint,
  ]
    .filter(Boolean)
    .join(t.sep)
}
