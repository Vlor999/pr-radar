import {
  apiUrl,
  byAccount,
  GITHUB,
  graphqlUrl,
  repoKey,
  retryEmpty,
  settle,
  splitKey,
  type Account,
  type AccountError,
} from "./accounts"
import { allAccounts, findAccount, rememberLogin, tokenOf } from "./auth"
import { fetch } from "./platform"
import { sweep, type Entry } from "./cache"
import {
  CHECKS_QUERY,
  checksTtlMs,
  rerunError,
  toCiView,
  type RawChecks,
} from "./checks"
import {
  assignableFrom,
  capPerAccount,
  gqlFailed,
  gqlMessage,
  restRepos,
  takeCost,
  withCost,
  type GqlResponse,
  type RepoNode,
} from "./graphql"
import {
  NODES_PER_QUERY,
  SEARCH_RESULTS_MAX,
  TIMELINE_ITEMS_MAX,
  TIMELINE_PAGE_SIZE,
} from "./constants"
import {
  fingerprint,
  isFullRead,
  mergeProbe,
  nextFullAt,
  splitProbe,
  type Snapshot,
} from "./delta"
import { pick, strings } from "./i18n"
import { mentionedIds, reasonOf, uniqueById } from "./involved"
import { log } from "./log"
import {
  toConversation,
  toPrEvents,
  withStackFallback,
  type RawConversation,
  type RawPrEvents,
} from "./pr-query"
import { addCost, trackQuota } from "./quota"
import { toReview, type RawReview } from "./review"
import {
  isBot,
  searchBounds,
  toTimelinePr,
  type RawTimelinePr,
} from "./timeline"
import type { Reviewer } from "./reviewers"
import type {
  CiView,
  Decision,
  MergedPr,
  Pr,
  ReviewPr,
  Thread,
  TimelinePr,
} from "./types"

const CACHE_TTL_MS = 60_000
const REPO_LIST_TTL_MS = 10 * 60_000
const REPOS_PER_QUERY = 5 // une requête de recherche GitHub est limitée en longueur et en opérateurs
const HUNK_LINES = 8 // GitHub montre aussi la fin du hunk, qui se termine sur la ligne commentée
const ASSIGNABLE_PAGE = 20 // assez pour un popover ; la recherche affine au-delà
// destinataires de DM Slack absents de la 1re page : une recherche par nom, en alias dans la même requête.
// Coût GraphQL : 1 point par requête tant que les connexions demandées restent sous 100 nœuds.
const DM_LOOKUP_PAGE = 5
const DM_LOOKUPS_MAX = 6
// destinataires de DM de la carte (reviewer fantôme) : les utilisateurs assignables changent rarement ;
// gardés 10 min et à l'actualisation, soit 1 point par PR concernée toutes les 10 min au plus
const DM_USERS_TTL_MS = 10 * 60_000
// table Slack → GitHub des réglages : utilisateurs assignables des repos suivis, une requête par compte,
// un alias par repo. Coût GraphQL ~ connexions demandées / 100 : 1 point par compte jusqu'à 100 repos.
const MAP_REPOS_MAX = 30 // par compte
/** sans recherche : toute la 1re page de chaque repo, rapprochée par nom en local */
const MAP_ALL_PAGE = 100
/** recherche tapée dans le sélecteur : quelques résultats par repo suffisent */
const MAP_SEARCH_PAGE = 10
/** clés de cache gardées par une actualisation (`clearCache` sans `all`) */
const KEPT_ON_REFRESH = ["repos:", "dmUsers:"]
// la recherche GitHub renvoie parfois 0 résultat sans erreur (~1 appel sur 3) : un vide est relu avant d'être cru.
// Reste ~1/27 par recherche (un lot de 5 repos), absorbé par `keepVanished` dans store.reload.
const EMPTY_SEARCH_RETRIES = 2
// recherche des mentions : un vide est courant (PR seulement commentée) ; une relance limite le motif
// « Impliqué » affiché à tort à la place de « Mentionné » (cosmétique, corrigé au chargement suivant)
const MENTION_SEARCH_RETRIES = 1

const S = strings(
  {
    notSignedIn: "Non connecté",
    tokenRejected: "Jeton GitHub refusé",
    http: (status: number) => `GitHub : HTTP ${status}`,
    invalidName: (repo: string) =>
      `Nom invalide : « ${repo} » (attendu : owner/repo)`,
    notFound: (repo: string) => `Repo introuvable ou inaccessible : ${repo}`,
  },
  {
    notSignedIn: "Not signed in",
    tokenRejected: "GitHub token rejected",
    http: (status: number) => `GitHub: HTTP ${status}`,
    invalidName: (repo: string) =>
      `Invalid name: "${repo}" (expected: owner/repo)`,
    notFound: (repo: string) => `Repo not found or inaccessible: ${repo}`,
  },
)

export const REPO_NAME = /^[\w.-]+\/[\w.-]+$/

/** Jeton refusé par GitHub (révoqué, expiré) : l'app propose de reconnecter ce compte. */
export class AuthError extends Error {
  name = "AuthError"
  account?: string
  constructor(message: string, account?: string) {
    super(message)
    this.account = account
  }
}

/** Où et avec quoi appeler GitHub : le jeton d'un compte ne part que vers l'hôte de ce compte. */
type Conn = { host: string; token: string | null; account?: string }
const conn = (a: Account): Conn => ({
  host: a.host,
  token: tokenOf(a.id),
  account: a.id,
})

function headers(token: string | null, account?: string) {
  if (!token) throw new AuthError(pick(S).notSignedIn, account)
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

async function gql<T>(
  c: Conn,
  query: string,
  variables: Record<string, unknown> = {},
  /** racines null + errors tolérées (voir `gqlFailed`) : l'appelant les ignore */
  { partial = false } = {},
): Promise<T> {
  const res = await fetch(graphqlUrl(c.host), {
    method: "POST",
    headers: {
      ...headers(c.token, c.account),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: withCost(query), variables }),
  })
  // quota rangé par compte connecté ; pas de compte (connexion en cours) ou compte déconnecté entre-temps : ignoré
  if (c.account && findAccount(c.account)) trackQuota(res.headers, c.account)
  if (res.status === 401) {
    log("warn", "github.error", { account: c.account, status: 401 })
    throw new AuthError(pick(S).tokenRejected, c.account)
  }
  const json = (await res.json()) as GqlResponse
  // points consommés même si la réponse est en échec : comptés avant le contrôle
  const cost = takeCost(json)
  if (cost !== undefined && c.account && findAccount(c.account))
    addCost(c.account, cost)
  if (partial && json.errors?.length)
    log("warn", "github.partial", {
      account: c.account,
      error: gqlMessage(json, ""),
    })
  if (gqlFailed(json, partial)) {
    const error = gqlMessage(json, pick(S).http(res.status))
    log("warn", "github.error", {
      account: c.account,
      status: res.status,
      error,
    })
    throw new Error(error)
  }
  return json.data as T
}

type Login = { author: { login: string } | null }
type RawComment = Login & { bodyHTML: string; url: string; createdAt: string }
type RawOpenPr = RawConversation & {
  id: string
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  mergeable: string
  viewerCanUpdateBranch: boolean
  reviewDecision: Decision
  headRefName: string
  baseRefName: string
  additions: number
  deletions: number
  changedFiles: number
  repository: { nameWithOwner: string }
  isCrossRepository: boolean
  author: { login: string; __typename?: string } | null
  assignees: { nodes: { login: string }[] }
  comments: { nodes: Login[] }
  reviewThreads: {
    nodes: {
      id: string
      isResolved: boolean
      isOutdated: boolean
      path: string
      line: number | null
      hunk: { nodes: { diffHunk: string }[] }
      comments: { nodes: RawComment[] }
    }[]
  }
  latestOpinionatedReviews: { nodes: (Login & { state: string })[] }
  reviewRequests: {
    nodes: { requestedReviewer: { login?: string; name?: string } | null }[]
  }
  commits: {
    nodes: {
      commit: { oid: string; statusCheckRollup: { state: string } | null }
    }[]
  }
  stackEntry?: {
    position: number
    stack: { number: number; size: number }
  } | null
}
type RawPr = RawOpenPr & RawPrEvents

type Page<N> = {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string }
    nodes: (N | null)[]
  }
}

const lastLines = (s: string, n: number) => s.split("\n").slice(-n).join("\n")
const chunk = <T>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) =>
    xs.slice(i * n, (i + 1) * n),
  )

/** Tous les résultats d'une recherche GraphQL, page par page. Résultat vide : relu `retries` fois
 * (seule la page 1 est vérifiée : une page suivante vide à tort tronque la liste sans erreur). */
async function searchAll<N>(
  c: Conn,
  query: string,
  q: string,
  retries = EMPTY_SEARCH_RETRIES,
): Promise<N[]> {
  return retryEmpty(retries, async () => {
    const out: N[] = []
    let after: string | null = null
    do {
      const { search }: Page<N> = await gql<Page<N>>(c, query, { q, after })
      out.push(
        ...search.nodes.filter((n): n is N => !!n && Object.keys(n).length > 0),
      )
      after = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null
    } while (after)
    return out
  })
}

/** Login du compte connecté (sert aussi à valider un jeton avant de l'enregistrer). */
export async function viewerLogin(
  token: string,
  host: string = GITHUB,
): Promise<string> {
  return (
    await gql<{ viewer: { login: string } }>(
      { host, token },
      "{ viewer { login } }",
    )
  ).viewer.login
}

const viewers = new Map<string, Promise<string>>()
function me(a: Account): Promise<string> {
  let v = viewers.get(a.id)
  if (!v) {
    v = gql<{ viewer: { login: string } }>(
      conn(a),
      "{ viewer { login } }",
    ).then(({ viewer }) => {
      rememberLogin(a.id, viewer.login)
      return viewer.login
    })
    viewers.set(a.id, v)
  }
  return v
}

function toPr(
  p: RawPr,
  login: string,
  account: string,
  mentioned: Set<string>,
): Pr {
  const reason = reasonOf(who(p), login, mentioned.has(p.id))
  const others = (nodes: Login[]) =>
    nodes.filter((n) => n.author?.login !== login).length
  const threads = p.reviewThreads.nodes
  return {
    id: p.id,
    repo: repoKey(account, p.repository.nameWithOwner),
    number: p.number,
    title: p.title,
    url: p.url,
    head: p.headRefName,
    base: p.baseRefName,
    draft: p.isDraft,
    decision: p.reviewDecision,
    conflicting: p.mergeable === "CONFLICTING",
    canUpdateBranch: p.viewerCanUpdateBranch,
    sha: p.commits.nodes[0]?.commit.oid ?? null,
    ci: p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    comments:
      others(p.comments.nodes) +
      threads.reduce((n, t) => n + others(t.comments.nodes), 0),
    unresolved: threads.filter((t) => !t.isResolved).length,
    threads: threads
      .filter((t) => !t.isResolved)
      .map((t): Thread => ({
        id: t.id,
        path: t.path,
        line: t.line,
        outdated: t.isOutdated,
        hunk: lastLines(t.hunk.nodes[0]?.diffHunk ?? "", HUNK_LINES),
        comments: t.comments.nodes.map((c) => ({
          author: c.author?.login ?? "ghost",
          body: c.bodyHTML,
          url: c.url,
          at: c.createdAt,
        })),
      })),
    conversation: toConversation(p),
    additions: p.additions,
    deletions: p.deletions,
    files: p.changedFiles,
    reviews: p.latestOpinionatedReviews.nodes
      .filter((r) => r.author)
      .map((r) => ({ who: r.author!.login, state: r.state })),
    requested: p.reviewRequests.nodes.flatMap(({ requestedReviewer: r }) =>
      r?.login
        ? [{ who: r.login }]
        : r?.name
          ? [{ who: r.name, team: true }]
          : [],
    ),
    updated: p.updatedAt,
    createdAt: p.createdAt,
    author: p.author?.login ?? "ghost",
    ...(isBot(p.author) && { bot: true }),
    events: toPrEvents(p),
    ...(p.stackEntry && {
      stack: { ...p.stackEntry.stack, position: p.stackEntry.position },
    }),
    ...(p.isCrossRepository && { fork: true }),
    ...(reason && {
      involved: { reason, author: p.author?.login ?? "ghost" },
    }),
  }
}

const who = (p: RawPr) => ({
  author: p.author?.login ?? null,
  assignees: p.assignees.nodes.map((n) => n.login),
})

// ponytail: caches en mémoire de la fenêtre, suffisent pour une app mono-utilisateur
const caches = new Map<string, Entry<unknown>>()
// dernière lecture par compte, puis par lot de repos (clé : ses noms) : un lot changé n'a pas d'instantané
const snapshots = new Map<string, Map<string, Snapshot<Pr>>>()

function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now()
  const hit = caches.get(key) as Entry<T> | undefined
  if (hit && now < hit.until) return hit.value
  sweep(caches, now)
  const value = load()
  const entry: Entry<T> = { until: now + ttl, value }
  value.then(
    (v) => (entry.resolved = { value: v, at: Date.now() }),
    () => caches.delete(key), // ne garde pas une erreur en cache
  )
  caches.set(key, entry)
  return value
}

/** Valeur déjà chargée et encore fraîche d'une clé, sans appel ; `null` : absente, en cours ou expirée. */
function peek<T>(key: string): { value: T; at: number } | null {
  const hit = caches.get(key) as Entry<T> | undefined
  return hit?.resolved && Date.now() < hit.until ? hit.resolved : null
}

/**
 * Rafraîchir : tout relire, sauf la liste des repos accessibles (lente, change rarement).
 * `all` (compte ajouté ou déconnecté) : aussi les logins et les instantanés des PR (actualisation par différence).
 */
export function clearCache({ all = false } = {}) {
  for (const k of caches.keys())
    if (all || !KEPT_ON_REFRESH.some((p) => k.startsWith(p))) caches.delete(k)
  if (all) {
    viewers.clear()
    snapshots.clear()
  }
}

/** Une requête par compte connecté, chacun avec son jeton et sur son hôte ; comptes en échec ignorés. */
const perAccount = async <T>(run: (a: Account) => Promise<T[]>) =>
  (await settle(allAccounts(), run)).data

/** Repos suivis par compte ; `run` reçoit les noms `owner/name` de ce compte. */
const perFollowed = <T>(
  repos: string[],
  run: (a: Account, names: string[]) => Promise<T[]>,
) => {
  const groups = byAccount(repos, allAccounts())
  return settle(
    groups.map(([a]) => a),
    (a) => run(a, groups.find(([g]) => g === a)![1]),
  )
}

// comptes dont GitHub a refusé `stackEntry` : la session continue sans les stacks natifs
const withoutStack = new Set<string>()

// ids seulement : ~1 point par page
const MENTIONS_QUERY = `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 100, after: $after) {
  pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { id } } } }`

/** Lecture complète de PR par leur id, par paquets de `NODES_PER_QUERY` ; id introuvable (PR supprimée) ignoré. */
async function fetchNodes(a: Account, ids: string[]): Promise<RawPr[]> {
  const out: RawPr[] = []
  for (const part of chunk(ids, NODES_PER_QUERY)) {
    const { nodes } = await withStackFallback(
      a.host,
      withoutStack.has(a.id),
      (query) =>
        gql<{ nodes: (RawPr | null)[] }>(conn(a), query, { ids: part }),
      () => withoutStack.add(a.id),
    )
    out.push(
      ...nodes.filter((n): n is RawPr => !!n && Object.keys(n).length > 0),
    )
  }
  return out
}

/**
 * PR ouvertes des repos suivis qui me concernent : les miennes, et celles des autres où je suis assigné,
 * mentionné ou impliqué (commentaire, review). `errors` : comptes en échec, les autres sont gardés.
 *
 * Coût : `involves:@me` (auteur OU assigné OU mentionné OU commentateur) remplace `author:@me`. Auteur et
 * assignés sont lus dans la réponse ; seul « mentionné » n'a pas de champ GraphQL : une recherche légère
 * `mentions:@me` (ids seulement), lancée uniquement s'il reste une PR relue d'un autre où je ne suis pas assigné.
 *
 * Par lot de repos, un sondage léger donne l'empreinte de chaque PR ; seules les PR nouvelles ou changées sont
 * relues en entier (`nodes(ids:)`), les autres reprises de la lecture précédente. `delta` faux (actualisation
 * manuelle, action, premier chargement), lot inconnu ou dernière relecture complète trop ancienne : tout est relu.
 * `full` : tous les lots relus en entier ; `refetched` : PR relues en entier.
 */
export function fetchPrs(
  repos: string[],
  { delta = false } = {},
): Promise<{
  data: Pr[]
  errors: AccountError[]
  full: boolean
  refetched: number
}> {
  return cached(`prs:${repos.join(",")}`, CACHE_TTL_MS, async () => {
    let full = true
    let refetched = 0
    const result = await perFollowed(repos, async (a, names) => {
      const login = await me(a)
      const known = snapshots.get(a.id)
      const next = new Map<string, Snapshot<Pr>>()
      const now = Date.now()
      const parts = await Promise.all(
        chunk(names, REPOS_PER_QUERY).map(async (c) => {
          const key = c.join(",")
          const filter = c.map((r) => "repo:" + r).join(" ")
          const prev = known?.get(key)
          const whole = isFullRead(prev, now, !delta)
          // ponytail: au premier chargement, chaque requête parallèle peut relancer une fois (accepté)
          const probe = uniqueById(
            await withStackFallback(
              a.host,
              withoutStack.has(a.id),
              (query) =>
                searchAll<{ id: string }>(
                  conn(a),
                  query,
                  "is:pr is:open involves:@me " + filter,
                ),
              () => withoutStack.add(a.id),
              "probe",
            ),
          ).map((n) => ({ id: n.id, fp: fingerprint(n) }))
          const { changed, kept } = splitProbe(probe, whole ? null : prev!.prs)
          const nodes = await fetchNodes(a, changed)
          let mentionsFailed = false
          const ids = await mentionedIds(nodes.map(who), login, () =>
            searchAll<{ id: string }>(
              conn(a),
              MENTIONS_QUERY,
              "is:pr is:open mentions:@me " + filter,
              MENTION_SEARCH_RETRIES,
            ).catch((e: unknown) => {
              mentionsFailed = true
              throw e
            }),
          )
          const fetched = new Map(
            nodes.map((p) => [p.id, toPr(p, login, a.id, ids)]),
          )
          const merged = mergeProbe(
            probe,
            kept,
            fetched,
            nextFullAt(whole, now, prev?.fullAt ?? 0, mentionsFailed),
          )
          next.set(key, merged.snapshot)
          if (!whole) full = false
          refetched += nodes.length
          return merged.prs
        }),
      )
      // compte en échec : rejeté avant, son instantané précédent reste
      snapshots.set(a.id, next)
      return parts.flat()
    })
    return { ...result, full, refetched }
  })
}

/** Repos (suivis ou non) où j'ai au moins une PR ouverte. */
export function reposWithMyOpenPrs(): Promise<string[]> {
  return cached("withPrs", CACHE_TTL_MS, async () => {
    const keys = await perAccount(async (a) =>
      (
        await searchAll<{ repository: { nameWithOwner: string } }>(
          conn(a),
          `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 100, after: $after) {
        pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { repository { nameWithOwner } } } } }`,
          "is:pr is:open author:@me",
        )
      ).map((n) => repoKey(a.id, n.repository.nameWithOwner)),
    )
    return [...new Set(keys)]
  })
}

/** Mes PR mergées entre deux dates (YYYY-MM-DD, incluses) sur les repos donnés, plus récentes d'abord. */
export function fetchMerged(
  repos: string[],
  from: string,
  to: string,
): Promise<MergedPr[]> {
  return cached(
    `merged:${repos.join(",")}|${from}..${to}`,
    CACHE_TTL_MS,
    async () => {
      type Raw = {
        number: number
        title: string
        url: string
        createdAt: string
        mergedAt: string
        repository: { nameWithOwner: string }
      }
      const { data } = await perFollowed(repos, async (a, names) =>
        (
          await Promise.all(
            chunk(names, REPOS_PER_QUERY).map((c) =>
              searchAll<Raw>(
                conn(a),
                `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { ... on PullRequest { number title url createdAt mergedAt repository { nameWithOwner } } } } }`,
                `is:pr is:merged author:@me merged:${from}..${to} ` +
                  c.map((r) => "repo:" + r).join(" "),
                0, // aucun merge sur la période est courant : pas de relance
              ),
            ),
          )
        )
          .flat()
          .map((p) => ({ ...p, account: a.id })),
      )
      return data
        .map((p): MergedPr => ({
          repo: repoKey(p.account, p.repository.nameWithOwner),
          number: p.number,
          title: p.title,
          url: p.url,
          createdAt: p.createdAt,
          mergedAt: p.mergedAt,
        }))
        .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
    },
  )
}

// vue Fil : PR et leurs derniers événements (pas les commits). Coût : voir TIMELINE_PAGE_SIZE.
const TIMELINE_QUERY = `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: ${TIMELINE_PAGE_SIZE}, after: $after) {
  issueCount pageInfo { hasNextPage endCursor }
  nodes { ... on PullRequest {
    number title url state isDraft createdAt mergedAt closedAt
    author { login __typename } repository { nameWithOwner }
    timelineItems(last: ${TIMELINE_ITEMS_MAX}, itemTypes: [PULL_REQUEST_REVIEW, ISSUE_COMMENT, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT, READY_FOR_REVIEW_EVENT]) { nodes {
      __typename
      ... on PullRequestReview { author { login } state submittedAt bodyText comments { totalCount } }
      ... on IssueComment { author { login } createdAt bodyText }
      ... on MergedEvent { actor { login } createdAt }
      ... on ClosedEvent { actor { login } createdAt }
      ... on ReopenedEvent { actor { login } createdAt }
      ... on ReadyForReviewEvent { actor { login } createdAt }
    } }
  } } } }`

/**
 * Une recherche de la vue Fil, page par page. `truncated` : plus de `SEARCH_RESULTS_MAX` résultats, GitHub
 * n'en sert pas davantage. Textes coupés dès la lecture (`toTimelinePr`) : le cache reste léger.
 */
async function searchTimeline(
  a: Account,
  login: string,
  q: string,
): Promise<{ prs: TimelinePr[]; truncated: boolean }> {
  type TimelinePage = Page<RawTimelinePr> & {
    search: { issueCount: number }
  }
  const prs: TimelinePr[] = []
  let truncated = false
  let after: string | null = null
  do {
    const { search }: TimelinePage = await gql<TimelinePage>(
      conn(a),
      TIMELINE_QUERY,
      { q, after },
    )
    truncated ||= search.issueCount > SEARCH_RESULTS_MAX
    for (const n of search.nodes)
      if (n && Object.keys(n).length > 0 && !isBot(n.author))
        prs.push(
          toTimelinePr(n, repoKey(a.id, n.repository.nameWithOwner), login),
        )
    after = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null
  } while (after)
  return { prs, truncated }
}

/**
 * Vue Fil : PR des repos suivis présentes entre deux dates (YYYY-MM-DD, incluses), de tout auteur sauf les
 * robots, avec leurs événements. Deux recherches par lot de repos : ouvertes avant la fin, et fermées (ou
 * mergées) après le début, bornes élargies d'un jour (dates UTC de GitHub). Lots lus l'un après l'autre :
 * pas de rafale de requêtes (limite secondaire de GitHub). `errors` : comptes en échec, les autres sont
 * gardés ; `truncated` : une recherche a dépassé 1 000 résultats.
 */
export function fetchTimeline(
  repos: string[],
  from: string,
  to: string,
): Promise<{ data: TimelinePr[]; errors: AccountError[]; truncated: boolean }> {
  return cached(
    `timeline:${repos.join(",")}|${from}..${to}`,
    CACHE_TTL_MS,
    async () => {
      const b = searchBounds(from, to)
      let truncated = false
      const result = await perFollowed(repos, async (a, names) => {
        const login = await me(a)
        const out: TimelinePr[] = []
        for (const c of chunk(names, REPOS_PER_QUERY)) {
          const filter = c.map((r) => "repo:" + r).join(" ")
          for (const q of [
            `is:pr is:open created:<=${b.to} ${filter}`,
            `is:pr is:closed closed:>=${b.from} created:<=${b.to} ${filter}`,
          ]) {
            const r = await searchTimeline(a, login, q)
            truncated ||= r.truncated
            out.push(...r.prs)
          }
        }
        return out
      })
      return { ...result, truncated }
    },
  )
}

// `ownerAffiliations` vaut [OWNER, COLLABORATOR] par défaut : sans ORGANIZATION_MEMBER, les repos d'org disparaissent
const REPOS_QUERY = `query($after: String) {
  viewer {
    login
    repositories(first: 100, after: $after, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: { field: PUSHED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { nameWithOwner isFork owner { login __typename } }
    }
  }
}`
type RepoPage = {
  viewer: {
    login: string
    repositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string }
      nodes: (RepoNode | null)[]
    }
  }
}

/** Tous les repos accessibles (les miens, collaborations, orgs), les plus récemment poussés d'abord. */
export function listRepos(): Promise<string[]> {
  return cached("repos:all", REPO_LIST_TTL_MS, () =>
    perAccount(async (a) => {
      const out: string[] = []
      let after: string | null = null
      do {
        const { login, repositories: r }: RepoPage["viewer"] = (
          await gql<RepoPage>(conn(a), REPOS_QUERY, { after })
        ).viewer
        out.push(...restRepos(r.nodes, login).map((n) => repoKey(a.id, n)))
        after = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null
      } while (after)
      return out
    }),
  )
}

/**
 * Vérifie que le repo existe et est accessible ; renvoie sa clé canonique.
 * Sans préfixe de compte (`owner/repo` saisi à la main) : le premier compte connecté qui le voit.
 */
export async function resolveRepo(repo: string): Promise<string> {
  const { account, name } = splitKey(repo)
  if (!REPO_NAME.test(name)) throw new Error(pick(S).invalidName(repo))
  const candidates = repo.includes(":")
    ? allAccounts().filter((a) => a.id === account)
    : allAccounts()
  for (const a of candidates) {
    const res = await fetch(`${apiUrl(a.host)}/repos/${name}`, {
      headers: headers(tokenOf(a.id), a.id),
    })
    if (res.ok)
      return repoKey(
        a.id,
        ((await res.json()) as { full_name: string }).full_name,
      )
  }
  throw new Error(pick(S).notFound(repo))
}

/** Répond dans un fil de review, en tant que le compte qui suit ce repo. */
export async function replyToThread(
  threadId: string,
  body: string,
  repo: string,
) {
  const a = findAccount(splitKey(repo).account)
  if (!a) throw new AuthError(pick(S).notSignedIn)
  await gql(
    conn(a),
    "mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } } }",
    { id: threadId, body },
  )
}

/** Commentaire général sur une PR, en tant que le compte qui suit ce repo. */
export async function commentOnPr(prId: string, body: string, repo: string) {
  const a = findAccount(splitKey(repo).account)
  if (!a) throw new AuthError(pick(S).notSignedIn)
  await gql(
    conn(a),
    "mutation($id: ID!, $body: String!) { addComment(input: { subjectId: $id, body: $body }) { commentEdge { node { id } } } }",
    { id: prId, body },
  )
}

/** Marque un fil de review comme résolu. */
export async function resolveThread(threadId: string, repo: string) {
  await gql(
    conn(accountOf(repo)),
    "mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }",
    { id: threadId },
  )
}

/** Sort une PR du mode draft. */
export async function markReady(prId: string, repo: string) {
  await gql(
    conn(accountOf(repo)),
    "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }",
    { id: prId },
  )
}

/** Merge la branche de base dans la branche de la PR (bouton « Update branch » de GitHub). */
export async function updateBranch(prId: string, repo: string) {
  await gql(
    conn(accountOf(repo)),
    "mutation($id: ID!) { updatePullRequestBranch(input: { pullRequestId: $id }) { pullRequest { id } } }",
    { id: prId },
  )
}

export type Profile = {
  login: string
  name: string | null
  avatarUrl: string
  url: string
}

/** Profil du compte connecté (réglages > Compte). */
export async function viewerProfile(a: Account): Promise<Profile> {
  return (
    await gql<{ viewer: Profile }>(
      conn(a),
      "{ viewer { login name avatarUrl url } }",
    )
  ).viewer
}

// coût GraphQL d'une page : 1 + 50 × 2 sous-connexions ≈ 1 point (bornes demandées, pas nœuds renvoyés)
const REVIEW_QUERY = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number title url isDraft createdAt reviewDecision
      author { login }
      repository { nameWithOwner }
      viewerLatestReview { state }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
      timelineItems(last: 20, itemTypes: [REVIEW_REQUESTED_EVENT]) { nodes { ... on ReviewRequestedEvent {
        createdAt requestedReviewer { ... on User { login } ... on Team { name } } } } }
    } }
  }
}`

/** PR qui attendent ma review (moi ou une de mes équipes), sur tous les repos accessibles. */
export function fetchReviews(): Promise<{
  data: ReviewPr[]
  errors: AccountError[]
}> {
  return cached("reviews", CACHE_TTL_MS, () =>
    settle(allAccounts(), async (a) => {
      const login = await me(a)
      return (
        await searchAll<RawReview>(
          conn(a),
          REVIEW_QUERY,
          "is:pr is:open archived:false review-requested:@me",
          0, // aucune review en attente est courant : pas de relance, la liste vide est gardée un chargement (store)
        )
      ).map((p) => toReview(p, login, a.id))
    }),
  )
}

const accountOf = (repo: string) => {
  const a = findAccount(splitKey(repo).account)
  if (!a) throw new AuthError(pick(S).notSignedIn)
  return a
}

type DmFields = Record<`dm${number}`, { nodes: Reviewer[] } | null>

/** Recherche de noms Slack parmi les utilisateurs assignables (6 au plus) : une variable et un alias par nom,
 * `$dm0` → `dm0: assignableUsers(…)`, lus ensuite par `read`. */
const dmLookup = (names: string[]) => {
  const lookups = names.slice(0, DM_LOOKUPS_MAX)
  return {
    vars: lookups.map((_, i) => `, $dm${i}: String!`).join(""),
    fields: lookups
      .map(
        (_, i) =>
          `dm${i}: assignableUsers(first: ${DM_LOOKUP_PAGE}, query: $dm${i}) { nodes { login id name } }`,
      )
      .join("\n"),
    values: Object.fromEntries(lookups.map((n, i) => [`dm${i}`, n])),
    read: (r: DmFields) => lookups.flatMap((_, i) => r[`dm${i}`]?.nodes ?? []),
  }
}

/**
 * Reviewers possibles d'une de mes PR : suggestions GitHub, puis utilisateurs assignables filtrés par `query`.
 * `dmNames` : noms Slack des destinataires de DM qui citent la PR ; chacun est cherché parmi les utilisateurs
 * assignables (`dm`), la 1re page pouvant ne pas les contenir.
 */
export async function fetchReviewerOptions(
  repo: string,
  number: number,
  query: string,
  dmNames: string[] = [],
): Promise<{
  prId: string
  viewer: string
  suggested: Reviewer[]
  assignable: Reviewer[]
  dm: Reviewer[]
}> {
  const [owner, name] = splitKey(repo).name.split("/")
  const dm = dmLookup(dmNames)
  const res = await gql<{
    viewer: { login: string }
    repository:
      | ({
          pullRequest: {
            id: string
            suggestedReviewers: { reviewer: Reviewer }[]
          } | null
          assignableUsers: { nodes: Reviewer[] } | null
        } & DmFields)
      | null
  }>(
    conn(accountOf(repo)),
    `query($owner: String!, $name: String!, $number: Int!, $q: String${dm.vars}) {
      viewer { login }
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) { id suggestedReviewers { reviewer { login id name } } }
        assignableUsers(first: ${ASSIGNABLE_PAGE}, query: $q) { nodes { login id name } }
        ${dm.fields}
      }
    }`,
    {
      owner,
      name,
      number,
      q: query || null,
      ...dm.values,
    },
  )
  // `repository` null + errors : `gql` lève déjà ; ici, PR absente (champ imbriqué) ou repo null sans erreur
  const r = res.repository
  const pr = r?.pullRequest
  const users = r?.assignableUsers
  if (!r || !pr || !users) throw new Error(pick(S).notFound(repo))
  return {
    prId: pr.id,
    viewer: res.viewer.login,
    suggested: pr.suggestedReviewers.map((s) => s.reviewer),
    assignable: users.nodes,
    dm: dm.read(r),
  }
}

/** Utilisateurs assignables trouvés par les noms Slack des destinataires de DM d'une PR (reviewer fantôme
 * de la carte) : seulement les champs aliasés, sans la PR ni la 1re page ; en cache 10 min. */
export function fetchDmReviewers(
  repo: string,
  names: string[],
): Promise<Reviewer[]> {
  return cached(
    `dmUsers:${repo}|${names.join("\n")}`,
    DM_USERS_TTL_MS,
    async () => {
      const [owner, name] = splitKey(repo).name.split("/")
      const dm = dmLookup(names)
      const res = await gql<{ repository: DmFields | null }>(
        conn(accountOf(repo)),
        `query($owner: String!, $name: String!${dm.vars}) {
          repository(owner: $owner, name: $name) { ${dm.fields} }
        }`,
        { owner, name, ...dm.values },
      )
      return res.repository ? dm.read(res.repository) : []
    },
  )
}

/** Utilisateur assignable d'un repo suivi, avec le compte PR Radar qui le voit. */
export type AssignableUser = Reviewer & { account: string }

/**
 * Utilisateurs assignables des repos suivis (30 au plus par compte, `truncated` au-delà), tous comptes, filtrés
 * par `query` : table Slack → GitHub des réglages (rapprochement par nom sans recherche, sélecteur avec).
 * Assignables plutôt que la recherche d'utilisateurs GitHub : seuls eux peuvent reviewer, et un homonyme inconnu
 * n'est pas proposé. Une requête par compte (un alias par repo), lue en mode partiel : un repo inaccessible
 * n'annule pas les autres. En cache 10 min, gardée à l'actualisation.
 */
export function searchAssignable(
  repos: string[],
  query: string,
): Promise<{ users: AssignableUser[]; truncated: boolean }> {
  const first = query ? MAP_SEARCH_PAGE : MAP_ALL_PAGE
  const { groups, truncated } = capPerAccount(
    byAccount(repos, allAccounts()),
    MAP_REPOS_MAX,
  )
  return cached(
    `dmUsers:assignable:${repos.join(",")}|${query}`,
    DM_USERS_TTL_MS,
    async () => {
      const { data } = await settle(
        groups.map(([a]) => a),
        async (a) => {
          const names = groups.find(([g]) => g === a)![1]
          const vars = names.map((_, i) => `, $o${i}: String!, $n${i}: String!`)
          const fields = names.map(
            (_, i) =>
              `r${i}: repository(owner: $o${i}, name: $n${i}) { assignableUsers(first: ${first}, query: $q) { nodes { login id name } } }`,
          )
          const res = await gql<
            Record<string, { assignableUsers: { nodes: Reviewer[] } } | null>
          >(
            conn(a),
            `query($q: String${vars.join("")}) { ${fields.join("\n")} }`,
            {
              q: query || null,
              ...Object.fromEntries(
                names.flatMap((n, i) => {
                  const [owner, name] = n.split("/")
                  return [
                    [`o${i}`, owner],
                    [`n${i}`, name],
                  ]
                }),
              ),
            },
            { partial: true },
          )
          return assignableFrom(res, names.length).map((u) => ({
            ...u,
            account: a.id,
          }))
        },
      )
      const seen = new Set<string>()
      const users = data.filter((u) => {
        const k = `${u.account}|${u.login.toLowerCase()}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      return { users, truncated }
    },
  )
}

/** Demande une review à un utilisateur ; `union` garde les demandes déjà en cours. */
export async function requestReviewer(
  prId: string,
  userId: string,
  repo: string,
) {
  // refus (pas de droit d'écriture) : `gql` lève le message de GitHub
  await gql(
    conn(accountOf(repo)),
    "mutation($pr: ID!, $user: ID!) { requestReviews(input: { pullRequestId: $pr, userIds: [$user], union: true }) { pullRequest { id } } }",
    { pr: prId, user: userId },
  )
}

const checksKey = (
  repo: string,
  number: number,
  sha: string | null,
  rollup: string | null,
) => `checks:${repo}#${number}@${sha}|${rollup}`

/** Vue CI d'une PR (ouverte depuis la pastille CI) ; commit de tête et état agrégé dans la clé du cache :
 * relue à un nouveau push ou quand l'état de la CI change. */
export function fetchChecks(
  repo: string,
  number: number,
  sha: string | null,
  rollup: string | null,
): Promise<CiView> {
  return cached(
    checksKey(repo, number, sha, rollup),
    checksTtlMs(rollup),
    async () => {
      const [owner, name] = splitKey(repo).name.split("/")
      return toCiView(
        await gql<RawChecks>(conn(accountOf(repo)), CHECKS_QUERY, {
          owner,
          name,
          number,
        }),
      )
    },
  )
}

/** Vue CI déjà chargée et fraîche pour ce commit et cet état agrégé (serveur MCP : aucun appel) ; `at` : lecture. */
export const cachedChecks = (
  repo: string,
  number: number,
  sha: string | null,
  rollup: string | null,
) => peek<CiView>(checksKey(repo, number, sha, rollup))

/** Relance les jobs en échec (et ceux qui en dépendent) d'un workflow run GitHub Actions. */
export async function rerunFailedJobs(repo: string, runId: number) {
  const a = accountOf(repo)
  const res = await fetch(
    `${apiUrl(a.host)}/repos/${splitKey(repo).name}/actions/runs/${runId}/rerun-failed-jobs`,
    { method: "POST", headers: headers(tokenOf(a.id), a.id) },
  )
  if (res.status === 401) throw new AuthError(pick(S).tokenRejected, a.id)
  if (res.ok) return
  const { message } = (await res.json().catch(() => ({}))) as {
    message?: string
  }
  throw new Error(rerunError(res.status, message))
}
