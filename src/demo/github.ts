// Démo navigateur : même API que src/lib/github.ts, données fictives (org « acme »).
import { trackQuota } from "@/lib/quota"
import type { MergedPr, Pr, Thread } from "@/lib/types"

export const REPO_NAME = /^[\w.-]+\/[\w.-]+$/

export class AuthError extends Error {
  name = "AuthError"
}

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

const REPOS = [
  "acme/web",
  "acme/api",
  "acme/mobile",
  "acme/infra",
  "acme/design-system",
  "acme/docs",
  "globex/billing",
  "globex/search",
  "globex/legacy-crm",
  "me/dotfiles",
  "me/blog",
]

const thread = (id: string, path: string, body: string): Thread => ({
  id,
  path,
  line: 42,
  outdated: false,
  hunk: "@@ -38,6 +38,8 @@\n   const user = await getUser(id)\n-  return user\n+  if (!user) throw new NotFound()\n+  return user",
  comments: [
    { author: "alice", body, url: "#", at: ago(5) },
    { author: "me", body: "Bonne idée, je corrige.", url: "#", at: ago(3) },
  ],
})

const pr = (p: Partial<Pr> & Pick<Pr, "repo" | "number" | "title">): Pr => ({
  url: `https://github.com/${p.repo}/pull/${p.number}`,
  head: `feat/${p.number}`,
  base: "main",
  draft: false,
  decision: "REVIEW_REQUIRED",
  conflicting: false,
  ci: "SUCCESS",
  comments: 0,
  unresolved: 0,
  threads: [],
  additions: 120,
  deletions: 30,
  files: 6,
  reviews: [],
  requested: ["alice"],
  updated: ago(2),
  ...p,
})

const PRS: Pr[] = [
  pr({
    repo: "acme/web",
    number: 412,
    title: "Refonte de la page de paiement",
    head: "feat/checkout",
    decision: "APPROVED",
    reviews: [{ who: "alice", state: "APPROVED" }],
    requested: [],
  }),
  pr({
    repo: "acme/web",
    number: 415,
    title: "Checkout : validation des adresses",
    head: "feat/checkout-address",
    base: "feat/checkout",
    unresolved: 1,
    comments: 2,
    threads: [
      thread(
        "t1",
        "src/checkout/address.ts",
        "On pourrait lever une erreur ici plutôt que renvoyer null.",
      ),
    ],
  }),
  pr({
    repo: "acme/web",
    number: 418,
    title: "Checkout : tests e2e",
    head: "feat/checkout-e2e",
    base: "feat/checkout-address",
    draft: true,
    ci: "PENDING",
  }),
  pr({
    repo: "acme/api",
    number: 88,
    title: "Pagination par curseur sur /orders",
    decision: "CHANGES_REQUESTED",
    reviews: [{ who: "bob", state: "CHANGES_REQUESTED" }],
    updated: ago(30),
  }),
  pr({
    repo: "acme/api",
    number: 91,
    title: "Mise à jour de Node 22",
    ci: "FAILURE",
    conflicting: true,
    updated: ago(150),
  }),
  pr({
    repo: "globex/billing",
    number: 7,
    title: "Export CSV des factures",
    additions: 640,
    deletions: 12,
    files: 14,
  }),
  // repo public hors de listRepos() : visible dans le panneau, pas suivi d'office
  pr({
    repo: "globex/status-page",
    number: 23,
    title: "Corrige le lien du flux RSS",
    additions: 4,
    deletions: 2,
    files: 1,
  }),
]

const MERGED: MergedPr[] = [
  {
    repo: "acme/web",
    number: 405,
    title: "Header responsive",
    url: "#",
    mergedAt: ago(20),
  },
  {
    repo: "acme/api",
    number: 85,
    title: "Rate limiting par clé API",
    url: "#",
    mergedAt: ago(70),
  },
  {
    repo: "globex/billing",
    number: 5,
    title: "TVA intracommunautaire",
    url: "#",
    mergedAt: ago(120),
  },
]

const has = (repos: string[]) => (r: string) =>
  repos.some((x) => x.toLowerCase() === r.toLowerCase())

export const viewerLogin = async () => "me"
export const clearCache = () => {}
export const fetchPrs = async (repos: string[]) => {
  // quota bas pour montrer la notification et la ligne des réglages
  trackQuota(
    new Headers({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "420",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1800),
    }),
  )
  return PRS.filter((p) => has(repos)(p.repo))
}
export const reposWithMyOpenPrs = async () => [
  ...new Set(PRS.map((p) => p.repo)),
]
export const fetchMerged = async (repos: string[], from: string, to: string) =>
  MERGED.filter(
    (m) =>
      has(repos)(m.repo) &&
      m.mergedAt.slice(0, 10) >= from &&
      m.mergedAt.slice(0, 10) <= to,
  )
export const listRepos = async () => REPOS
export async function resolveRepo(repo: string) {
  if (!REPO_NAME.test(repo))
    throw new Error(`Nom invalide : « ${repo} » (attendu : owner/repo)`)
  return repo
}
export const replyToThread = async (threadId: string, body: string) => {
  console.info("[demo] reply", threadId, body)
}

export type Profile = {
  login: string
  name: string | null
  avatarUrl: string
  url: string
}
export const viewerProfile = async (): Promise<Profile> => ({
  login: "me",
  name: "Démo",
  avatarUrl: "https://github.com/identicons/me.png",
  url: "#",
})
