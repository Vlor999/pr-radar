// Démo navigateur : même API que src/lib/github.ts, données fictives (org « acme »).
// Un compte GitHub Enterprise ajouté dans les réglages (hôte au choix, jeton quelconque) voit `globex/ledger`.
import {
  DEFAULT_ID,
  repoKey,
  type Account,
  type AccountError,
} from "@/lib/accounts"
import { allAccounts } from "@/lib/auth"
import { trackQuota } from "@/lib/quota"
import type { Reviewer } from "@/lib/reviewers"
import type { MergedPr, Pr, ReviewPr, Thread } from "@/lib/types"

export const REPO_NAME = /^[\w.-]+\/[\w.-]+$/

export class AuthError extends Error {
  name = "AuthError"
  account?: string
  constructor(message: string, account?: string) {
    super(message)
    this.account = account
  }
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

/** URL github.com fictive : affiche les avatars, clés de liste distinctes */
const COMMENT_URL = "https://github.com/acme/web/pull/1#discussion_"

const thread = (id: string, path: string, body: string): Thread => ({
  id,
  path,
  line: 42,
  outdated: false,
  hunk: "@@ -38,6 +38,8 @@\n   const user = await getUser(id)\n-  return user\n+  if (!user) throw new NotFound()\n+  return user",
  comments: [
    { author: "alice", body, url: `${COMMENT_URL}${id}-1`, at: ago(5) },
    {
      author: "me",
      body: "Bonne idée, je corrige.",
      url: `${COMMENT_URL}${id}-2`,
      at: ago(3),
    },
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
  requested: [{ who: "alice" }],
  updated: ago(2),
  ...p,
})

const PRS: Pr[] = [
  pr({
    repo: "acme/web",
    number: 412,
    title: "Refonte de la page de paiement",
    head: "feat/checkout",
    stack: { number: 5, position: 1, size: 3 }, // stack natif GitHub (le globex/ledger des autres comptes reste déduit)
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
    stack: { number: 5, position: 2, size: 3 },
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
    stack: { number: 5, position: 3, size: 3 },
    draft: true,
    ci: "PENDING",
  }),
  pr({
    repo: "acme/api",
    number: 88,
    title: "Pagination par curseur sur /orders",
    decision: "CHANGES_REQUESTED",
    // discussion + messages Slack, sans PR stackée (voir src/demo/slack.ts)
    unresolved: 1,
    comments: 2,
    threads: [
      thread(
        "t2",
        "src/orders/cursor.ts",
        "Le curseur devrait être opaque (base64) plutôt qu'un id brut.",
      ),
    ],
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
  // repo public hors de listRepos() : non suivi dans la démo (voir la graine plus bas),
  // visible dans le panneau avec le point vert
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

// démo vierge : suit les repos à PR, sauf globex/status-page (même clé que src/lib/store.ts)
try {
  if (!localStorage.getItem("pr-radar:repos"))
    localStorage.setItem(
      "pr-radar:repos",
      JSON.stringify(["acme/web", "acme/api", "globex/billing"]),
    )
} catch {}

// comptes ajoutés : un repo et deux PR stackées chacun, sur leur hôte
const others = () => allAccounts().filter((a) => a.id !== DEFAULT_ID)
const otherRepos = () => others().map((a) => repoKey(a.id, "globex/ledger"))
const otherPrs = () =>
  others().flatMap((a) => {
    const repo = repoKey(a.id, "globex/ledger")
    const url = (n: number) => `https://${a.host}/globex/ledger/pull/${n}`
    return [
      pr({
        repo,
        number: 31,
        title: "Rapprochement bancaire automatique",
        url: url(31),
        head: "feat/reconcile",
      }),
      pr({
        repo,
        number: 33,
        title: "Rapprochement : import OFX",
        url: url(33),
        head: "feat/reconcile-ofx",
        base: "feat/reconcile",
        ci: "PENDING",
      }),
    ]
  })

const has = (repos: string[]) => (r: string) =>
  repos.some((x) => x.toLowerCase() === r.toLowerCase())

export const viewerLogin = async (_token: string, _host?: string) => "me"
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
  return {
    data: [...PRS, ...otherPrs()].filter((p) => has(repos)(p.repo)),
    errors: [] as AccountError[],
  }
}
export const reposWithMyOpenPrs = async () => [
  ...new Set([...PRS.map((p) => p.repo), ...otherRepos()]),
]
export const fetchMerged = async (repos: string[], from: string, to: string) =>
  MERGED.filter(
    (m) =>
      has(repos)(m.repo) &&
      m.mergedAt.slice(0, 10) >= from &&
      m.mergedAt.slice(0, 10) <= to,
  )
export const listRepos = async () => [...REPOS, ...otherRepos()]
export async function resolveRepo(repo: string) {
  if (!REPO_NAME.test(repo))
    throw new Error(`Nom invalide : « ${repo} » (attendu : owner/repo)`)
  return repo
}
export const replyToThread = async (
  threadId: string,
  body: string,
  repo: string,
) => {
  console.info("[demo] reply", threadId, body, repo)
}

export type Profile = {
  login: string
  name: string | null
  avatarUrl: string
  url: string
}
export const viewerProfile = async (_a: Account): Promise<Profile> => ({
  login: "me",
  name: "Démo",
  avatarUrl: "https://github.com/identicons/me.png",
  url: "#",
})

// onglet « À reviewer » : nominative, équipe, draft, re-request, équipe déjà approuvée
const review = (
  p: Partial<ReviewPr> & Pick<ReviewPr, "repo" | "number" | "title">,
): ReviewPr => ({
  url: `https://github.com/${p.repo}/pull/${p.number}`,
  author: "alice",
  draft: false,
  decision: "REVIEW_REQUIRED",
  direct: true,
  teams: [],
  rerequest: false,
  since: ago(4),
  ...p,
})

const REVIEWS: ReviewPr[] = [
  review({
    repo: "acme/web",
    number: 421,
    title: "Mode sombre du tableau de bord",
    since: ago(52),
  }),
  review({
    repo: "acme/web",
    number: 423,
    title: "Cache des images produit",
    author: "bob",
    rerequest: true,
    since: ago(3),
  }),
  review({
    repo: "acme/api",
    number: 94,
    title: "Webhooks : signature HMAC",
    author: "carol",
    direct: false,
    teams: ["backend"],
    since: ago(26),
  }),
  review({
    repo: "acme/api",
    number: 96,
    title: "Index sur orders.created_at",
    author: "dave",
    direct: false,
    teams: ["backend"],
    decision: "APPROVED",
    since: ago(8),
  }),
  review({
    repo: "globex/search",
    number: 12,
    title: "Synonymes dans la recherche",
    author: "erin",
    draft: true,
    since: ago(100),
  }),
]

export const fetchReviews = async () => ({
  data: REVIEWS,
  errors: [] as AccountError[],
})

const DEMO_USERS = ["alice", "bob", "carol", "dave", "erin", "frank"]
const user = (login: string): Reviewer => ({ login, id: `U_${login}` })
export const fetchReviewerOptions = async (
  repo: string,
  number: number,
  query: string,
) => ({
  prId: `${repo}#${number}`,
  viewer: "me",
  suggested: ["bob", "carol"].map(user),
  assignable: ["me", ...DEMO_USERS]
    .filter((l) => l.includes(query.toLowerCase()))
    .map(user),
})
export const requestReviewer = async (
  prId: string,
  userId: string,
  repo: string,
) => {
  // « dave » montre le message brut de GitHub pour un jeton sans droit d'écriture
  if (userId === "U_dave")
    throw new Error(
      "me does not have the correct permissions to execute `RequestReviews`",
    )
  // la demande apparaît sur la carte au rechargement qui suit
  const p = PRS.find((p) => `${p.repo}#${p.number}` === prId)
  p?.requested.push({ who: userId.slice(2) })
  console.info("[demo] request review", prId, userId, repo)
}
