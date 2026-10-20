import { fetch } from "@tauri-apps/plugin-http"

import { currentToken } from "./auth"
import type { Decision, MergedPr, Pr, Thread } from "./types"

const API = "https://api.github.com"
const CACHE_TTL_MS = 60_000
const REPO_LIST_TTL_MS = 10 * 60_000
const PAGE_SIZE = 50 // limite GitHub : ~500k nœuds par requête avec les connexions imbriquées
const REPOS_PER_QUERY = 5 // une requête de recherche GitHub est limitée en longueur et en opérateurs
const MAX_BODY = 4000 // caractères gardés par message de discussion
const HUNK_LINES = 8 // GitHub montre aussi la fin du hunk, qui se termine sur la ligne commentée

export const REPO_NAME = /^[\w.-]+\/[\w.-]+$/

/** Jeton refusé par GitHub (révoqué, expiré) : l'app repasse à l'écran de connexion. */
export class AuthError extends Error {
  name = "AuthError"
}

function headers(token = currentToken()) {
  if (!token) throw new AuthError("Non connecté")
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<T> {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  if (res.status === 401) throw new AuthError("Jeton GitHub refusé")
  const json = (await res.json()) as {
    data?: T
    errors?: { message: string }[]
  }
  // GitHub renvoie des données partielles quand un repo d'org est inaccessible (SSO, restriction) : on les garde
  if (!json.data)
    throw new Error(
      json.errors?.map((e) => e.message).join(" ; ") ??
        `GitHub : HTTP ${res.status}`,
    )
  return json.data
}

/** GET REST, toutes les pages (en-tête Link). */
async function restAll<T>(path: string): Promise<T[]> {
  const out: T[] = []
  let url: string | null = `${API}${path}`
  while (url) {
    const res = await fetch(url, { headers: headers() })
    if (res.status === 401) throw new AuthError("Jeton GitHub refusé")
    if (!res.ok) throw new Error(`GitHub : HTTP ${res.status} sur ${path}`)
    out.push(...((await res.json()) as T[]))
    url =
      /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null
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
      reviewThreads(first: 100) { nodes { id isResolved isOutdated path line
        hunk: comments(first: 1) { nodes { diffHunk } }
        comments(first: 50) { nodes { author { login } bodyText url createdAt } } } }
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
async function searchAll<N>(query: string, q: string): Promise<N[]> {
  const out: N[] = []
  let after: string | null = null
  do {
    const { search }: Page<N> = await gql<Page<N>>(query, { q, after })
    out.push(
      ...search.nodes.filter((n): n is N => !!n && Object.keys(n).length > 0),
    )
    after = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null
  } while (after)
  return out
}

/** Login du compte connecté (sert aussi à valider un jeton avant de l'enregistrer). */
export async function viewerLogin(token?: string): Promise<string> {
  return (
    await gql<{ viewer: { login: string } }>("{ viewer { login } }", {}, token)
  ).viewer.login
}

let viewer: Promise<string> | undefined
const me = () => (viewer ??= viewerLogin())

function toPr(p: RawPr, login: string): Pr {
  const others = (nodes: Login[]) =>
    nodes.filter((n) => n.author?.login !== login).length
  const threads = p.reviewThreads.nodes
  return {
    repo: p.repository.nameWithOwner,
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
  if (all) viewer = undefined
}

export function fetchPrs(repos: string[]): Promise<Pr[]> {
  return cached(`prs:${repos.join(",")}`, CACHE_TTL_MS, async () => {
    const login = await me()
    const parts = await Promise.all(
      chunk(repos, REPOS_PER_QUERY).map((c) =>
        searchAll<RawPr>(
          QUERY,
          "is:pr is:open author:@me " + c.map((r) => "repo:" + r).join(" "),
        ),
      ),
    )
    return parts.flat().map((p) => toPr(p, login))
  })
}

/** Repos (suivis ou non) où j'ai au moins une PR ouverte. */
export function reposWithMyOpenPrs(): Promise<string[]> {
  return cached("withPrs", CACHE_TTL_MS, async () => {
    const nodes = await searchAll<{ repository: { nameWithOwner: string } }>(
      `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 100, after: $after) {
        pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { repository { nameWithOwner } } } } }`,
      "is:pr is:open author:@me",
    )
    return [...new Set(nodes.map((n) => n.repository.nameWithOwner))]
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
      const parts = await Promise.all(
        chunk(repos, REPOS_PER_QUERY).map((c) =>
          searchAll<Raw>(
            `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { ... on PullRequest { number title url mergedAt repository { nameWithOwner } } } } }`,
            `is:pr is:merged author:@me merged:${from}..${to} ` +
              c.map((r) => "repo:" + r).join(" "),
          ),
        ),
      )
      return parts
        .flat()
        .map((p): MergedPr => ({
          repo: p.repository.nameWithOwner,
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
  return cached("repos:all", REPO_LIST_TTL_MS, async () =>
    (
      await restAll<{ full_name: string }>(
        "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=pushed",
      )
    ).map((r) => r.full_name),
  )
}

/** Vérifie que le repo existe et est accessible ; renvoie son nom canonique. */
export async function resolveRepo(repo: string): Promise<string> {
  if (!REPO_NAME.test(repo))
    throw new Error(`Nom invalide : « ${repo} » (attendu : owner/repo)`)
  const res = await fetch(`${API}/repos/${repo}`, { headers: headers() })
  if (!res.ok) throw new Error(`Repo introuvable ou inaccessible : ${repo}`)
  return ((await res.json()) as { full_name: string }).full_name
}

/** Répond dans un fil de review, en tant que l'utilisateur connecté. */
export async function replyToThread(threadId: string, body: string) {
  await gql(
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
export async function viewerProfile(): Promise<Profile> {
  return (
    await gql<{ viewer: Profile }>("{ viewer { login name avatarUrl url } }")
  ).viewer
}
