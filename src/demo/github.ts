// Démo navigateur : même API que src/lib/github.ts, données fictives (orgs « acme », « globex »).
// Un compte GitHub Enterprise ajouté dans les réglages (hôte au choix, jeton quelconque) voit `globex/ledger`.
import {
  DEFAULT_ID,
  GITHUB,
  repoKey,
  type Account,
  type AccountError,
} from "@/lib/accounts"
import { allAccounts } from "@/lib/auth"
import { rerunError } from "@/lib/checks"
import { HOUR_MS } from "@/lib/quiet"
import { addCost, trackQuota } from "@/lib/quota"
import type { Reviewer } from "@/lib/reviewers"
import type {
  CiJob,
  CiState,
  CiView,
  CiWorkflow,
  MergedPr,
  Pr,
  ReviewPr,
  Thread,
  TimelineEvent,
  TimelinePr,
} from "@/lib/types"

import { DEMO_DM_USERS } from "./slack"

/** latence d'une mutation GitHub : laisse voir l'état « en cours » des boutons */
const MUTATION_MS = 800
/** latence de la première lecture des jobs d'une PR : laisse voir le chargement de la vue CI */
const CHECKS_MS = 600
/** points GraphQL d'une actualisation (`rateLimit { cost }`) : avec le quota de `fetchReviews`, le mode auto affiche ~3 min */
const REFRESH_POINTS = 120
/** latence d'une actualisation (pas du premier chargement) : laisse voir la pastille grise et l'icône qui tourne */
const REFRESH_MS = 800
/**
 * issue des actualisations après le premier chargement : `?refresh=partial` (PR mergées en échec,
 * pastille orange), `?refresh=failed` (lecture des PR en échec, pastille rouge) ; sans paramètre, réussies
 */
const refreshMode = new URLSearchParams(location.search).get("refresh")
let prReads = 0
let mergedReads = 0

export const REPO_NAME = /^[\w.-]+\/[\w.-]+$/

export class AuthError extends Error {
  name = "AuthError"
  account?: string
  constructor(message: string, account?: string) {
    super(message)
    this.account = account
  }
}

const ago = (h: number) => new Date(Date.now() - h * HOUR_MS).toISOString()

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
  createdAt: ago(72),
  author: p.involved?.author ?? "me",
  events: [],
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
  // PR des autres qui me concernent (motif en pastille), dans l'arbre avec les miennes
  pr({
    repo: "acme/web",
    number: 420,
    title: "Checkout : traductions du formulaire",
    head: "feat/checkout-i18n",
    base: "feat/checkout", // stackée sur ma #412
    involved: { reason: "assigned", author: "alice" },
    decision: "APPROVED", // approuvée, mais pas « prête à merger » : ce n'est pas la mienne
    reviews: [{ who: "bob", state: "APPROVED" }],
    requested: [],
    updated: ago(6),
  }),
  pr({
    repo: "acme/web",
    number: 423,
    title: "Cache des images produit",
    head: "perf/image-cache",
    // aussi dans « À reviewer » (re-request) : j'ai déjà reviewé, donc impliqué
    involved: { reason: "involved", author: "bob" },
    reviews: [{ who: "me", state: "COMMENTED" }],
    requested: [{ who: "me" }],
    updated: ago(3),
  }),
  pr({
    repo: "acme/api",
    number: 93,
    title: "Logs structurés des workers",
    involved: { reason: "mentioned", author: "carol" },
    comments: 4,
    requested: [{ who: "dave" }],
    updated: ago(10),
  }),
  pr({
    repo: "globex/billing",
    number: 9,
    title: "Arrondi des montants en JPY",
    head: "main", // branche main d'un fork : ne devient pas la base de mes PR
    fork: true,
    involved: { reason: "involved", author: "erin" },
    ci: "FAILURE",
    decision: "CHANGES_REQUESTED",
    reviews: [{ who: "me", state: "CHANGES_REQUESTED" }],
    requested: [],
    updated: ago(28),
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
    createdAt: ago(20 + 26),
    mergedAt: ago(20),
  },
  {
    repo: "acme/api",
    number: 85,
    title: "Rate limiting par clé API",
    url: "#",
    createdAt: ago(70 + 3 * 24),
    mergedAt: ago(70),
  },
  {
    repo: "globex/billing",
    number: 5,
    title: "TVA intracommunautaire",
    url: "#",
    createdAt: ago(120 + 9),
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
  // deux modes de connexion et un hôte Enterprise dans les réglages (même clé que src/lib/auth.ts)
  if (!localStorage.getItem("pr-radar:accounts"))
    localStorage.setItem(
      "pr-radar:accounts",
      JSON.stringify([
        { id: DEFAULT_ID, host: GITHUB, source: "oauth" },
        {
          id: "me@ghe.globex.example",
          host: "ghe.globex.example",
          source: "pat",
          login: "me",
        },
      ] satisfies Account[]),
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
// PR dont les jobs ont déjà été lus : pas de latence ensuite, comme le cache de src/lib/github.ts ; une
// actualisation (clearCache) la remet
// acme/api#91 (CI en échec) : déjà lue au lancement, `get_checks` la sert depuis le cache
const checksRead = new Set<string>(["acme/api#91"])
export const clearCache = () => checksRead.clear()
export const fetchPrs = async (
  repos: string[],
  { delta = false }: { delta?: boolean } = {},
) => {
  if (prReads++) {
    await new Promise((r) => setTimeout(r, REFRESH_MS))
    if (refreshMode === "failed") throw new Error("HTTP 502 (démo)")
  }
  // quota bas pour montrer la notification et la ligne des réglages
  trackQuota(
    new Headers({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "420",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1800),
    }),
    DEFAULT_ID,
  )
  const data = [...PRS, ...otherPrs()].filter((p) => has(repos)(p.repo))
  // actualisation automatique : rien n'a changé depuis la lecture précédente
  return {
    data,
    errors: [] as AccountError[],
    full: !delta,
    refetched: delta ? 0 : data.length,
  }
}
export const reposWithMyOpenPrs = async () => [
  ...new Set([
    ...PRS.filter((p) => !p.involved).map((p) => p.repo),
    ...otherRepos(),
  ]),
]
export const fetchMerged = async (
  repos: string[],
  from: string,
  to: string,
) => {
  if (mergedReads++ && refreshMode === "partial")
    throw new Error("HTTP 502 (démo)")
  return MERGED.filter(
    (m) =>
      has(repos)(m.repo) &&
      m.mergedAt.slice(0, 10) >= from &&
      m.mergedAt.slice(0, 10) <= to,
  )
}
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

// quota qui baisse de REFRESH_POINTS par actualisation, fenêtre de 45 min : 120 × 45 / (3000 - 1000) ≈ 3 min.
// Lancé juste après `fetchPrs` (store.reload) : son quota bas déclenche la notification, celui-ci sert au mode auto.
let demoRemaining = 3120
const demoReset = Date.now() + 45 * 60_000
export const fetchReviews = async () => {
  addCost(DEFAULT_ID, REFRESH_POINTS)
  trackQuota(
    new Headers({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": String((demoRemaining -= REFRESH_POINTS)),
      "x-ratelimit-reset": String(Math.floor(demoReset / 1000)),
    }),
    DEFAULT_ID,
  )
  return { data: REVIEWS, errors: [] as AccountError[] }
}

// « erin-l » (Erin Laurent) : destinataire d'un DM Slack sur acme/api#88 (src/demo/slack.ts), rapproché par son nom
const DEMO_USERS: Reviewer[] = [
  { login: "alice", id: "U_alice", name: "Alice Martin" },
  { login: "bob", id: "U_bob", name: "Bob Durand" },
  { login: "carol", id: "U_carol", name: null },
  { login: "dave", id: "U_dave", name: "Dave Moreau" },
  { login: "erin-l", id: "U_erin-l", name: "Erin Laurent" },
  // « Frank Petit » a deux comptes GitHub : table Slack → GitHub des réglages, cas 1:N
  { login: "frank", id: "U_frank", name: "Frank Petit" },
  { login: "fpetit", id: "U_fpetit", name: "Frank Petit" },
]
const ME: Reviewer = { login: "me", id: "U_me", name: null }
/** comme ASSIGNABLE_PAGE de src/lib/github.ts, réduit pour que le DM Slack soit hors de la 1re page */
const ASSIGNABLE_PAGE = 4
const DM_LOOKUP_PAGE = 5
/** latence simulée de `searchAssignable` sans recherche (table Slack → GitHub des réglages) */
const ASSIGNABLE_MS = 1_200
/** latence simulée de la mutation `requestReviews` : la demande s'affiche avant la réponse */
const REQUEST_MS = 1_500

const search = (q: string, first: number) =>
  [ME, ...DEMO_USERS]
    .filter((u) =>
      [u.login, u.name ?? ""].some((s) =>
        s.toLowerCase().includes(q.toLowerCase()),
      ),
    )
    .slice(0, first)

export const fetchReviewerOptions = async (
  repo: string,
  number: number,
  query: string,
  dmNames: string[] = [],
) => ({
  prId: `${repo}#${number}`,
  viewer: "me",
  suggested: DEMO_USERS.filter((u) => ["bob", "carol"].includes(u.login)),
  assignable: search(query, ASSIGNABLE_PAGE),
  dm: dmNames.flatMap((n) => search(n, DM_LOOKUP_PAGE)),
})
export const fetchDmReviewers = async (_repo: string, names: string[]) =>
  names.flatMap((n) => search(n, DM_LOOKUP_PAGE))
export const searchAssignable = async (_repos: string[], query: string) => {
  // correspondances par nom de la table Slack → GitHub : elles arrivent après les lignes
  if (!query) await new Promise((r) => setTimeout(r, ASSIGNABLE_MS))
  const q = query.toLowerCase()
  return {
    users: [
      ...search(query, DEMO_USERS.length + 1),
      ...DEMO_DM_USERS.filter((u) =>
        [u.login, u.name ?? ""].some((s) => s.toLowerCase().includes(q)),
      ),
    ].map((u) => ({ ...u, account: DEFAULT_ID })),
    truncated: false,
  }
}
export const requestReviewer = async (
  prId: string,
  userId: string,
  repo: string,
) => {
  await new Promise((r) => setTimeout(r, REQUEST_MS))
  // « dave » montre le message brut de GitHub pour un jeton sans droit d'écriture
  if (userId === "U_dave")
    throw new Error(
      "me does not have the correct permissions to execute `RequestReviews`",
    )
  // la demande apparaît sur la carte au rechargement qui suit
  // popover : `repo#numéro` ; reviewer fantôme de la carte : id du nœud de la PR
  const p = PRS.find((p) => `${p.repo}#${p.number}` === prId || p.id === prId)
  p?.requested.push({ who: userId.slice(2) })
  console.info("[demo] request review", prId, userId, repo)
}

/* ---------- Vue CI (ouverte depuis la pastille CI) ---------- */

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
  hiddenJobs = 0,
): CiWorkflow => ({
  key,
  name,
  file,
  event: "pull_request",
  runId,
  jobs,
  hiddenJobs,
})
const statuses = (jobs: CiJob[]): CiWorkflow => ({
  key: "statuses",
  name: null,
  file: null,
  event: null,
  runId: null,
  jobs,
  hiddenJobs: 0,
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
      workflow(
        "ci",
        "CI",
        "ci.yml",
        4181,
        [
          job("lint", "success", 3, 38),
          job("test", "running", 2),
          job("e2e", "queued"),
          job("source-branch", "skipped", 3, 0),
        ],
        12,
      ), // matrice au-delà de la borne de la requête : ligne « 12 jobs non affichés »
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
): Promise<CiView> => {
  const key = `${repo}#${number}`
  if (!checksRead.has(key)) {
    await new Promise((done) => setTimeout(done, CHECKS_MS))
    checksRead.add(key)
  }
  console.info("[demo] checks", repo, number)
  return { workflows: checksFor(number, rollup), moreChecks: false }
}

export const cachedChecks = (
  repo: string,
  number: number,
  _sha: string | null,
  rollup: string | null,
): { value: CiView; at: number } | null =>
  checksRead.has(`${repo}#${number}`)
    ? {
        value: { workflows: checksFor(number, rollup), moreChecks: false },
        at: Date.now(),
      }
    : null

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

/* ---------- Vue Fil : cas limites, dates relatives à maintenant ---------- */

const DAY_START = () => {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}
/** `d` jours depuis aujourd'hui (négatif : passé), à `h:m` */
const on = (d: number, h: number, m = 0) => {
  const t = DAY_START()
  return new Date(
    t.getFullYear(),
    t.getMonth(),
    t.getDate() + d,
    h,
    m,
  ).toISOString()
}
const minAgo = (min: number) =>
  new Date(Date.now() - min * 60_000).toISOString()
const LOREM = "lorem ipsum dolor sit amet ".repeat(30)

const tl = (
  repo: string,
  number: number,
  title: string,
  state: TimelinePr["state"],
  events: TimelineEvent[],
  draft = false,
): TimelinePr => {
  const author = events[0].who ?? "me"
  return {
    repo,
    number,
    title,
    url: `https://github.com/${repo}/pull/${number}`,
    state,
    draft,
    author,
    mine: author === "me",
    createdAt: events[0].at,
    events,
  }
}

const timeline = (): TimelinePr[] => [
  // ouverte avant la fenêtre, changements demandés, commentaire très long, relances Slack
  tl(
    "acme/api",
    141,
    "feat(billing): proration des abonnements en cours de mois",
    "OPEN",
    [
      { kind: "start", at: on(-26, 10), who: "me" },
      {
        kind: "review",
        review: "CHANGES_REQUESTED",
        at: on(-20, 11),
        who: "ada",
        text: "Le calcul au prorata ignore les fuseaux, voir le cas du 31.",
        threads: 4,
      },
      {
        kind: "comment",
        at: on(-19, 16),
        who: "me",
        text:
          'Corrigé, j\'ai ajouté les cas de test :\n```ts\nexpect(prorata("2026-01-31", plan)).toBe(1290)\nexpect(prorata("2026-02-28", plan)).toBe(1000)\n```\nEt un commentaire très long pour la troncature de l\'info-bulle : ' +
          LOREM,
      },
      {
        kind: "review",
        review: "COMMENTED",
        at: on(-4, 17),
        who: "linus",
        text: "",
        threads: 2,
      },
    ],
  ),
  // ouverte et mergée le même jour, événements groupés
  tl(
    "acme/web",
    112,
    "fix(nav): lien actif perdu après rechargement",
    "MERGED",
    [
      { kind: "start", at: on(-1, 9), who: "me" },
      {
        kind: "comment",
        at: on(-1, 9, 20),
        who: "grace",
        text: "Ok je regarde",
      },
      {
        kind: "review",
        review: "APPROVED",
        at: on(-1, 9, 35),
        who: "grace",
        text: "LGTM",
      },
      { kind: "merge", at: on(-1, 10, 5), who: "me" },
    ],
  ),
  // changements demandés puis fermée sans merge
  tl("acme/web", 115, "feat(search): recherche floue côté client", "CLOSED", [
    { kind: "start", at: on(-6, 11), who: "me" },
    {
      kind: "review",
      review: "CHANGES_REQUESTED",
      at: on(-5, 10),
      who: "ada",
      text: "On garde la recherche serveur, le bundle prend 40 ko.",
    },
    {
      kind: "comment",
      at: on(-4, 15),
      who: "me",
      text: "Compris, je ferme et je repars sur l'endpoint.",
    },
    { kind: "close", at: on(-3, 9), who: "me" },
  ]),
  // brouillon ouvert il y a une heure
  tl(
    "acme/api",
    144,
    "chore(deps): montée de version du client HTTP",
    "OPEN",
    [{ kind: "start", at: minAgo(60), who: "me" }],
    true,
  ),
  // PR d'un autre, sans activité depuis 10 jours
  tl("globex/billing", 31, "ci: cache des dépendances entre jobs", "OPEN", [
    { kind: "start", at: on(-10, 14), who: "linus" },
  ]),
  // fermée, rouverte, puis mergée
  tl("acme/api", 140, "feat(auth): rotation des refresh tokens", "MERGED", [
    { kind: "start", at: on(-12, 10), who: "me" },
    { kind: "close", at: on(-8, 18), who: "me" },
    { kind: "reopen", at: on(-7, 9), who: "me" },
    {
      kind: "review",
      review: "APPROVED",
      at: on(-3, 11),
      who: "linus",
      text: "",
    },
    { kind: "merge", at: on(-2, 16), who: "me" },
  ]),
  // PR d'un autre : rafale de 12 événements dans la journée
  tl("acme/web", 118, "refactor(forms): un seul hook de validation", "MERGED", [
    { kind: "start", at: on(-4, 9), who: "grace" },
    ...Array.from({ length: 12 }, (_, i): TimelineEvent => ({
      kind: i % 3 ? "comment" : "review",
      review: i === 11 ? "APPROVED" : "COMMENTED",
      at: on(-4, 10, i * 10),
      who: i % 2 ? "grace" : "me",
      text: `Échange ${i + 1} sur le nommage du hook`,
    })),
    { kind: "merge", at: on(-4, 12, 40), who: "me" },
  ]),
  // PR d'un autre, approuvée et mergée par moi
  tl(
    "acme/api",
    145,
    "fix(webhooks): signature vérifiée sur le corps brut",
    "MERGED",
    [
      { kind: "start", at: on(-2, 15), who: "ada" },
      {
        kind: "review",
        review: "APPROVED",
        at: minAgo(240),
        who: "me",
        text: "Bien vu",
      },
      { kind: "merge", at: minAgo(180), who: "me" },
    ],
  ),
  // titre très long, brouillon passé en revue
  tl(
    "acme/web",
    120,
    "feat(dashboard): export CSV des tableaux filtrés avec colonnes choisies, encodage UTF-8 et séparateur configurable",
    "OPEN",
    [
      { kind: "start", at: on(-3, 8), who: "me" },
      { kind: "ready", at: on(-2, 10), who: "me" },
      {
        kind: "review",
        review: "COMMENTED",
        at: minAgo(90),
        who: "grace",
        text: "Deux remarques sur l'encodage",
        threads: 2,
      },
    ],
  ),
]

export const fetchTimeline = async (
  repos: string[],
  from: string,
  to: string,
): Promise<{
  data: TimelinePr[]
  errors: AccountError[]
  truncated: boolean
}> => {
  await new Promise((r) => setTimeout(r, REFRESH_MS))
  const end = new Date(`${to}T23:59:59`).toISOString()
  const start = new Date(`${from}T00:00:00`).toISOString()
  return {
    data: timeline().filter((p) => {
      const done = p.events.find(
        (e) => e.kind === "merge" || e.kind === "close",
      )
      return (
        has(repos)(p.repo) &&
        p.createdAt <= end &&
        (p.state === "OPEN" || (!!done && done.at >= start))
      )
    }),
    errors: [],
    truncated: false,
  }
}
