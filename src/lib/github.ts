import { fetch } from "@tauri-apps/plugin-http"

import {
  apiUrl,
  byAccount,
  GITHUB,
  graphqlUrl,
  repoKey,
  settle,
  splitKey,
  type Account,
  type AccountError,
} from "./accounts"
import { allAccounts, findAccount, rememberLogin, tokenOf } from "./auth"
import { pick, strings } from "./i18n"
import { trackQuota } from "./quota"
import type { Decision, MergedPr, Pr, Thread } from "./types"

const CACHE_TTL_MS = 60_000
const REPO_LIST_TTL_MS = 10 * 60_000
const PAGE_SIZE = 20 // le coût GraphQL suit les bornes demandées, pas les nœuds renvoyés : 20 × 50 fils × 20 messages ≈ 21 points (103 avec 50 × 100 × 50)
const REPOS_PER_QUERY = 5 // une requête de recherche GitHub est limitée en longueur et en opérateurs
const MAX_BODY = 4000 // caractères gardés par message de discussion
const HUNK_LINES = 8 // GitHub montre aussi la fin du hunk, qui se termine sur la ligne commentée

const S = strings(
  {
    notSignedIn: "Non connecté",
    tokenRejected: "Jeton GitHub refusé",
    http: (status: number) => `GitHub : HTTP ${status}`,
    httpOn: (status: number, path: string) =>
      `GitHub : HTTP ${status} sur ${path}`,
    invalidName: (repo: string) =>
      `Nom invalide : « ${repo} » (attendu : owner/repo)`,
    notFound: (repo: string) => `Repo introuvable ou inaccessible : ${repo}`,
  },
  {
    notSignedIn: "Not signed in",
    tokenRejected: "GitHub token rejected",
    http: (status: number) => `GitHub: HTTP ${status}`,
    httpOn: (status: number, path: string) =>
      `GitHub: HTTP ${status} on ${path}`,
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
  trackQuota(res.headers)
  if (res.status === 401) throw new AuthError(pick(S).tokenRejected, c.account)
  const json = (await res.json()) as {
    data?: T
    errors?: { message: string }[]
  }
  // GitHub renvoie des données partielles quand un repo d'org est inaccessible (SSO, restriction) : on les garde
  if (!json.data)
    throw new Error(
      json.errors?.map((e) => e.message).join(" ; ") ??
        pick(S).http(res.status),
    )
  return json.data
}

/** GET REST, toutes les pages (en-tête Link). */
async function restAll<T>(c: Conn, path: string): Promise<T[]> {
  const out: T[] = []
  const base = apiUrl(c.host)
  let url: string | null = `${base}${path}`
  while (url) {
    const res = await fetch(url, { headers: headers(c.token, c.account) })
    if (res.status === 401)
      throw new AuthError(pick(S).tokenRejected, c.account)
    if (!res.ok) throw new Error(pick(S).httpOn(res.status, path))
    out.push(...((await res.json()) as T[]))
    url =
      /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null
    if (url && !url.startsWith(`${base}/`)) url = null // le jeton ne suit pas un lien vers un autre hôte
  }
  return out
}

const QUERY = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: ${PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number title url isDraft updatedAt mergeable reviewDecision headRefName baseRefName additions deletions changedFiles
      repository { nameWithOwner }
      comments(first: 100) { nodes { author { login } } }
      reviewThreads(first: 50) { nodes { id isResolved isOutdated path line
        hunk: comments(first: 1) { nodes { diffHunk } }
        comments(first: 20) { nodes { author { login } bodyText url createdAt } } } }
      latestOpinionatedReviews(first: 20) { nodes { author { login } state } }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
}`

type Login = { author: { login: string } | null }
type RawComment = Login & { bodyText: string; url: string; createdAt: string }
type RawPr = {
  number: number
  title: string
  url: string
  isDraft: boolean
  updatedAt: string
  mergeable: string
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
    nodes: { commit: { statusCheckRollup: { state: string } | null } }[]
  }
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

/** Tous les résultats d'une recherche GraphQL, page par page. */
async function searchAll<N>(c: Conn, query: string, q: string): Promise<N[]> {
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
    repo: repoKey(account, p.repository.nameWithOwner),
    number: p.number,
    title: p.title,
    url: p.url,
    head: p.headRefName,
    base: p.baseRefName,
    draft: p.isDraft,
    decision: p.reviewDecision,
    conflicting: p.mergeable === "CONFLICTING",
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
          body:
            c.bodyText.length > MAX_BODY
              ? c.bodyText.slice(0, MAX_BODY) + "…"
              : c.bodyText,
          url: c.url,
          at: c.createdAt,
        })),
      })),
    additions: p.additions,
    deletions: p.deletions,
    files: p.changedFiles,
    reviews: p.latestOpinionatedReviews.nodes
      .filter((r) => r.author)
      .map((r) => ({ who: r.author!.login, state: r.state })),
    requested: p.reviewRequests.nodes
      .map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.name)
      .filter((x): x is string => !!x),
    updated: p.updatedAt,
  }
}

// ponytail: caches en mémoire de la fenêtre, suffisent pour une app mono-utilisateur
type Entry<T> = { at: number; value: Promise<T> }
const caches = new Map<string, Entry<unknown>>()

function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = caches.get(key) as Entry<T> | undefined
  if (hit && Date.now() - hit.at < ttl) return hit.value
  const value = load()
  value.catch(() => caches.delete(key)) // ne garde pas une erreur en cache
  caches.set(key, { at: Date.now(), value })
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

/** Mes PR ouvertes ; `errors` : comptes en échec, les autres sont gardés. */
export function fetchPrs(
  repos: string[],
): Promise<{ data: Pr[]; errors: AccountError[] }> {
  return cached(`prs:${repos.join(",")}`, CACHE_TTL_MS, () =>
    perFollowed(repos, async (a, names) => {
      const login = await me(a)
      const parts = await Promise.all(
        chunk(names, REPOS_PER_QUERY).map((c) =>
          searchAll<RawPr>(
            conn(a),
            QUERY,
            "is:pr is:open author:@me " + c.map((r) => "repo:" + r).join(" "),
          ),
        ),
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

/** Tous les repos accessibles (les miens, collaborations, orgs), les plus récemment poussés d'abord. */
export function listRepos(): Promise<string[]> {
  return cached("repos:all", REPO_LIST_TTL_MS, () =>
    perAccount(async (a) =>
      (
        await restAll<{ full_name: string }>(
          conn(a),
          "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=pushed",
        )
      ).map((r) => repoKey(a.id, r.full_name)),
    ),
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
