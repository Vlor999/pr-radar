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
import { CHECKS_QUERY, rerunError, toCiView, type RawChecks } from "./checks"
import {
  gqlFailed,
  gqlMessage,
  restRepos,
  type GqlResponse,
  type RepoNode,
} from "./graphql"
import { pick, strings } from "./i18n"
import {
  toConversation,
  withStackFallback,
  type RawConversation,
} from "./pr-query"
import { trackQuota, validQuota, type Quota } from "./quota"
import { toReview, type RawReview } from "./review"
import type { Reviewer } from "./reviewers"
import type { CiView, Decision, MergedPr, Pr, ReviewPr, Thread } from "./types"

const CACHE_TTL_MS = 60_000
const REPO_LIST_TTL_MS = 10 * 60_000
const REPOS_PER_QUERY = 5 // une requête de recherche GitHub est limitée en longueur et en opérateurs
const HUNK_LINES = 8 // GitHub montre aussi la fin du hunk, qui se termine sur la ligne commentée
const ASSIGNABLE_PAGE = 20 // assez pour un popover ; la recherche affine au-delà
// la recherche GitHub renvoie parfois 0 résultat sans erreur (~1 appel sur 3) : un vide est relu avant d'être cru.
// Reste ~1/27 par recherche (un lot de 5 repos), absorbé par `keepVanished` dans store.reload.
const EMPTY_SEARCH_RETRIES = 2

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
): Promise<T> {
  const res = await fetch(graphqlUrl(c.host), {
    method: "POST",
    headers: {
      ...headers(c.token, c.account),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  })
  // quota rangé par compte connecté ; pas de compte (connexion en cours) ou compte déconnecté entre-temps : ignoré
  if (c.account && findAccount(c.account)) trackQuota(res.headers, c.account)
  if (res.status === 401) throw new AuthError(pick(S).tokenRejected, c.account)
  const json = (await res.json()) as GqlResponse
  if (gqlFailed(json))
    throw new Error(gqlMessage(json, pick(S).http(res.status)))
  return json.data as T
}

type Login = { author: { login: string } | null }
type RawComment = Login & { bodyHTML: string; url: string; createdAt: string }
type RawPr = RawConversation & {
  id: string
  number: number
  title: string
  url: string
  isDraft: boolean
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

function toPr(p: RawPr, login: string, account: string): Pr {
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
    ...(p.stackEntry && {
      stack: { ...p.stackEntry.stack, position: p.stackEntry.position },
    }),
  }
}

// ponytail: caches en mémoire de la fenêtre, suffisent pour une app mono-utilisateur
const caches = new Map<string, Entry<unknown>>()

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
  value.catch(() => caches.delete(key)) // ne garde pas une erreur en cache
  caches.set(key, { until: now + ttl, value })
  return value
}

/** Rafraîchir : tout relire, sauf la liste des repos accessibles (lente, change rarement). */
export function clearCache({ all = false } = {}) {
  for (const k of caches.keys())
    if (all || !k.startsWith("repos:")) caches.delete(k)
  if (all) viewers.clear()
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

/** Mes PR ouvertes ; `errors` : comptes en échec, les autres sont gardés. */
export function fetchPrs(
  repos: string[],
): Promise<{ data: Pr[]; errors: AccountError[] }> {
  return cached(`prs:${repos.join(",")}`, CACHE_TTL_MS, () =>
    perFollowed(repos, async (a, names) => {
      const login = await me(a)
      const parts = await Promise.all(
        chunk(names, REPOS_PER_QUERY).map((c) => {
          const q =
            "is:pr is:open author:@me " + c.map((r) => "repo:" + r).join(" ")
          // ponytail: au premier chargement, chaque requête parallèle peut relancer une fois (accepté)
          return withStackFallback(
            a.host,
            withoutStack.has(a.id),
            (query) => searchAll<RawPr>(conn(a), query, q),
            () => withoutStack.add(a.id),
          )
        }),
      )
      return parts.flat().map((p) => toPr(p, login, a.id))
    }),
  )
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
            nodes { ... on PullRequest { number title url mergedAt repository { nameWithOwner } } } } }`,
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
          mergedAt: p.mergedAt,
        }))
        .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
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

/** Quota GraphQL d'un compte (`GET /rate_limit`, gratuit : ne compte pas dans la limite) ; null si absent ou en échec. */
export async function rateLimit(a: Account): Promise<Quota | null> {
  try {
    const res = await fetch(`${apiUrl(a.host)}/rate_limit`, {
      headers: headers(tokenOf(a.id), a.id),
    })
    if (!res.ok) return null
    const { resources } = (await res.json()) as {
      resources?: {
        graphql?: { limit: number; remaining: number; reset: number }
      }
    }
    const g = resources?.graphql
    if (!g) return null
    const q = {
      limit: g.limit,
      remaining: g.remaining,
      resetAt: g.reset * 1000,
    }
    return validQuota(q) ? q : null
  } catch {
    return null
  }
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

/** Reviewers possibles d'une de mes PR : suggestions GitHub, puis utilisateurs assignables filtrés par `query`. */
export async function fetchReviewerOptions(
  repo: string,
  number: number,
  query: string,
): Promise<{
  prId: string
  viewer: string
  suggested: Reviewer[]
  assignable: Reviewer[]
}> {
  const [owner, name] = splitKey(repo).name.split("/")
  const res = await gql<{
    viewer: { login: string }
    repository: {
      pullRequest: {
        id: string
        suggestedReviewers: { reviewer: Reviewer }[]
      } | null
      assignableUsers: { nodes: Reviewer[] } | null
    } | null
  }>(
    conn(accountOf(repo)),
    `query($owner: String!, $name: String!, $number: Int!, $q: String) {
      viewer { login }
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) { id suggestedReviewers { reviewer { login id } } }
        assignableUsers(first: ${ASSIGNABLE_PAGE}, query: $q) { nodes { login id } }
      }
    }`,
    { owner, name, number, q: query || null },
  )
  // `repository` null + errors : `gql` lève déjà ; ici, PR absente (champ imbriqué) ou repo null sans erreur
  const pr = res.repository?.pullRequest
  const users = res.repository?.assignableUsers
  if (!pr || !users) throw new Error(pick(S).notFound(repo))
  return {
    prId: pr.id,
    viewer: res.viewer.login,
    suggested: pr.suggestedReviewers.map((s) => s.reviewer),
    assignable: users.nodes,
  }
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

/** Vue CI d'une PR (ouverte depuis la pastille CI) ; commit de tête et état agrégé dans la clé du cache :
 * relue à un nouveau push ou quand l'état de la CI change. */
export function fetchChecks(
  repo: string,
  number: number,
  sha: string | null,
  rollup: string | null,
): Promise<CiView> {
  return cached(
    `checks:${repo}#${number}@${sha}|${rollup}`,
    CACHE_TTL_MS,
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
