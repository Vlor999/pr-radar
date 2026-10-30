// Démo navigateur : même API que src/lib/github.ts, données fictives (org « acme »).
// Un compte GitHub Enterprise ajouté dans les réglages (hôte au choix, jeton quelconque) voit `globex/ledger`.
import {
  DEFAULT_ID,
  repoKey,
  type Account,
  type AccountError,
} from "@/lib/accounts"
import { allAccounts } from "@/lib/auth"
import { rerunError } from "@/lib/checks"
import { trackQuota, type Quota } from "@/lib/quota"
import type { Reviewer } from "@/lib/reviewers"
import type {
  CiJob,
  CiState,
  CiWorkflow,
  MergedPr,
  Pr,
  ReviewPr,
  Thread,
} from "@/lib/types"

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

// corps au format `bodyHTML` de GitHub (balisage simplifié, mêmes classes)
const SUGGESTION_ROW = (kind: "deletion" | "addition", code: string) =>
  `<tr class="border-0"><td class="blob-num blob-num-${kind} blob-num-hidden" data-line-number="·"></td><td class="blob-code-inner blob-code-${kind} js-blob-code-${kind} blob-code-marker-${kind}">${code}</td></tr>`
const SUGGESTION = `<p>On pourrait lever une erreur ici plutôt que renvoyer <code class="notranslate">null</code>.</p>
<div class="my-2 border rounded-2 js-suggested-changes-blob diff-view">
<div class="f6 p-2 lh-condensed border-bottom d-flex"><div class="flex-auto flex-items-center color-fg-muted">Suggested change</div></div>
<div itemprop="text" class="blob-wrapper data file"><table class="d-table tab-size mb-0 width-full"><tbody>
${SUGGESTION_ROW("deletion", "  return null")}
${SUGGESTION_ROW("addition", "  throw new InvalidAddress(input)")}
</tbody></table></div></div>`
const CODE_BLOCK = `<p>PR à reprendre : l'API des commandes a bougé entre-temps. Nouvelle signature :</p>
<div class="highlight highlight-source-ts notranslate position-relative overflow-auto"><pre><span class="pl-k">export</span> <span class="pl-k">async</span> <span class="pl-k">function</span> <span class="pl-en">listOrders</span>(<span class="pl-s1">cursor</span>?: <span class="pl-smi">string</span>): <span class="pl-smi">Promise</span>&lt;<span class="pl-smi">Page</span>&lt;<span class="pl-smi">Order</span>&gt;&gt;</pre></div>`

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
      body: "<p>Bonne idée, je corrige.</p>",
      url: `${COMMENT_URL}${id}-2`,
      at: ago(3),
    },
  ],
})

const pr = (p: Partial<Pr> & Pick<Pr, "repo" | "number" | "title">): Pr => ({
  id: `PR_${p.number}`,
  url: `https://github.com/${p.repo}/pull/${p.number}`,
  head: `feat/${p.number}`,
  base: "main",
  draft: false,
  decision: "REVIEW_REQUIRED",
  conflicting: false,
  canUpdateBranch: false,
  sha: `sha-${p.number}`,
  ci: "SUCCESS",
  comments: 0,
  unresolved: 0,
  threads: [],
  conversation: [],
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
    threads: [thread("t1", "src/checkout/address.ts", SUGGESTION)],
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
    comments: 3,
    threads: [
      thread(
        "t2",
        "src/orders/cursor.ts",
        '<p>Le curseur devrait être opaque (<code class="notranslate">base64</code>) plutôt qu\'un id brut, comme dans <a class="issue-link js-issue-link" href="https://github.com/acme/api/pull/80">#80</a>.</p>',
      ),
    ],
    reviews: [{ who: "bob", state: "CHANGES_REQUESTED" }],
    // commentaires généraux, hors fichier
    conversation: [
      {
        author: "carol",
        body: CODE_BLOCK,
        url: `${COMMENT_URL}c88-1`,
        at: ago(26),
      },
      {
        author: "bob",
        body: "<p>Le principe me va, voir le commentaire sur le curseur.</p>",
        url: `${COMMENT_URL}c88-2`,
        at: ago(24),
        state: "CHANGES_REQUESTED",
      },
    ],
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
    canUpdateBranch: true, // branche en retard sur main : bouton « Mettre à jour la branche »
    // commentaire général seul, sans fil sur un fichier
    comments: 1,
    conversation: [
      {
        author: "dave",
        body: "<p>Pense à l'encodage UTF-8 avec BOM pour Excel.</p>",
        url: `${COMMENT_URL}c7-1`,
        at: ago(4),
      },
    ],
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
    DEFAULT_ID,
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
export const commentOnPr = async (prId: string, body: string, repo: string) => {
  console.info("[demo] comment", prId, body, repo)
}

const findPr = (prId: string) => PRS.find((p) => p.id === prId)
/** latence d'une mutation GitHub : laisse voir l'état « en cours » des boutons */
const MUTATION_MS = 800
const latency = () => new Promise((done) => setTimeout(done, MUTATION_MS))
export const resolveThread = async (threadId: string, repo: string) => {
  await latency()
  // le fil disparaît de la carte au rechargement qui suit
  const p = PRS.find((p) => p.threads.some((t) => t.id === threadId))
  if (p) {
    p.threads = p.threads.filter((t) => t.id !== threadId)
    p.unresolved = p.threads.length
  }
  console.info("[demo] resolve", threadId, repo)
}
export const markReady = async (prId: string, repo: string) => {
  await latency()
  const p = findPr(prId)
  if (p) p.draft = false
  console.info("[demo] ready", prId, repo)
}
export const updateBranch = async (prId: string, repo: string) => {
  await latency()
  const p = findPr(prId)
  if (p) p.canUpdateBranch = false
  console.info("[demo] update branch", prId, repo)
}

// quota qui baisse de 120 points par actualisation : le mode auto affiche ~3 min dès la 2e actualisation
let demoRemaining = 3120
const demoReset = Date.now() + 45 * 60_000
export const rateLimit = async (_a: Account): Promise<Quota | null> => ({
  limit: 5000,
  remaining: (demoRemaining -= 120),
  resetAt: demoReset,
})
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

/* ---------- Vue CI (ouverte depuis la pastille CI) ---------- */

/** latence de la requête des jobs : laisse voir le chargement de la vue CI */
const CHECKS_MS = 600
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
/** job lancé il y a `startMin` minutes, durée `s` secondes ; `s` null : encore en cours */
const job = (
  name: string,
  state: CiState,
  startMin: number | null = null,
  s: number | null = null,
): CiJob => ({
  name,
  state,
  startedAt: startMin === null ? null : minsAgo(startMin),
  completedAt:
    startMin === null || s === null
      ? null
      : new Date(Date.parse(minsAgo(startMin)) + s * 1000).toISOString(),
  url: `https://github.com/acme/web/actions/runs/1/job/${encodeURIComponent(name)}`,
})
const workflow = (
  key: string,
  name: string,
  file: string,
  runId: number,
  jobs: CiJob[],
): CiWorkflow => ({ key, name, file, event: "pull_request", runId, jobs })
const statuses = (jobs: CiJob[]): CiWorkflow => ({
  key: "statuses",
  name: null,
  file: null,
  event: null,
  runId: null,
  jobs,
})

/** workflow run de acme/api#91 (seule PR en échec) relancé (ses jobs en échec repartent) ; celui de CodeQL refuse la relance */
const RERUN_OK = 9101
const RERUN_REFUSED = 9102
const rerunAt = new Map<number, number>()

const checksFor = (number: number, ci: string | null): CiWorkflow[] => {
  if (number === 91) {
    const since = rerunAt.get(RERUN_OK)
    const again = (name: string): CiJob =>
      since
        ? {
            ...job(name, "running"),
            startedAt: new Date(since).toISOString(),
          }
        : job(name, "failure", 12, 74)
    return [
      workflow("ci", "CI", "ci.yml", RERUN_OK, [
        job("lint", "success", 12, 41),
        again("test (node 22)"),
        job("test (node 20)", "success", 12, 95),
        job("build", "cancelled", 12, 80),
        job("deploy-preview", "skipped", 10, 0),
      ]),
      workflow("codeql", "CodeQL", "codeql.yml", RERUN_REFUSED, [
        job("analyze (javascript)", "failure", 12, 203),
      ]),
    ]
  }
  if (ci === "PENDING")
    return [
      workflow("ci", "CI", "ci.yml", 4181, [
        job("lint", "success", 3, 38),
        job("test", "running", 2),
        job("e2e", "queued"),
        job("source-branch", "skipped", 3, 0),
      ]),
      statuses([job("ci/circleci: build", "running")]),
    ]
  return [
    workflow("ci", "CI", "ci.yml", 1, [
      job("check", "success", 40, 91),
      job("source-branch", "skipped", 40, 0),
    ]),
    workflow("pages", "Deploy site", "pages.yml", 2, [
      job("build", "success", 40, 52),
      job("deploy", "neutral", 39, 12),
    ]),
    statuses([job("netlify/deploy-preview", "success")]),
  ]
}

export const fetchChecks = async (
  repo: string,
  number: number,
  _sha: string | null,
  rollup: string | null,
): Promise<CiWorkflow[]> => {
  await new Promise((done) => setTimeout(done, CHECKS_MS))
  console.info("[demo] checks", repo, number)
  return checksFor(number, rollup)
}

export const rerunFailedJobs = async (repo: string, runId: number) => {
  await latency()
  if (runId === RERUN_REFUSED)
    throw new Error(
      rerunError(403, "Resource not accessible by personal access token"),
    )
  rerunAt.set(runId, Date.now())
  const p = PRS.find((p) => p.repo === repo && p.ci === "FAILURE")
  if (p) p.ci = "PENDING"
  console.info("[demo] rerun failed jobs", repo, runId)
}
