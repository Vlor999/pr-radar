export type Decision =
  "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null

/** Fil de review non résolu : où il est, et ses messages dans l'ordre. */
export type Thread = {
  id: string
  path: string
  line: number | null
  /** le code a changé depuis le commentaire */
  outdated: boolean
  /** fin du diff autour de la ligne commentée */
  hunk: string
  /** `body` : HTML rendu par GitHub (`bodyHTML`), à assainir avant affichage */
  comments: { author: string; body: string; url: string; at: string }[]
}

/** Commentaire général de la PR ou texte d'une review ; `state` : celui de la review. */
export type Note = Thread["comments"][number] & { state?: string }

export type Pr = {
  /** id GraphQL (nœud) de la PR */
  id: string
  /** `owner/name` */
  repo: string
  number: number
  title: string
  url: string
  head: string
  base: string
  draft: boolean
  decision: Decision
  conflicting: boolean
  /** branche en retard sur sa base et que je peux mettre à jour (`viewerCanUpdateBranch`) */
  canUpdateBranch: boolean
  /** commit de tête de la PR (`oid`) */
  sha: string | null
  ci: string | null
  comments: number
  unresolved: number
  threads: Thread[]
  /** 10 derniers commentaires généraux et textes des 30 dernières reviews, du plus ancien au plus récent */
  conversation: Note[]
  additions: number
  deletions: number
  files: number
  reviews: { who: string; state: string }[]
  /** reviews demandées ; `team` : une équipe (nom affiché, pas un login) */
  requested: { who: string; team?: boolean }[]
  updated: string
  /** stack natif GitHub (`stackEntry`) ; absent : stack déduit des branches */
  stack?: { number: number; position: number; size: number }
}

/** Une PR dans l'arbre : ses enfants sont les PR stackées sur sa branche. */
export type PrNode = Pr & { parent: number | null; children: PrNode[] }

/** Racine d'un repo : une branche de base (main, ou branche sans PR à moi). */
export type Root = { branch: string; trunk: boolean; children: PrNode[] }

/** PR à moi mergée récemment. */
export type MergedPr = {
  repo: string
  number: number
  title: string
  url: string
  mergedAt: string
}

export type RepoTree = { repo: string; roots: Root[]; merged: MergedPr[] }

/** Message Slack qui contient le lien d'une PR. */
export type SlackMention = {
  author: string
  channelId: string
  /** `#nom` d'un channel, `DM` pour un message direct ou de groupe */
  where: string
  at: string
  text: string
  permalink: string
}

/** Conversation Slack proposée dans les réglages. */
export type SlackConversation = {
  id: string
  name: string
  kind: "public" | "private" | "im" | "mpim"
}

/** PR d'un autre qui attend ma review (onglet « À reviewer »). */
export type ReviewPr = {
  repo: string
  number: number
  title: string
  url: string
  author: string
  draft: boolean
  decision: Decision
  /** demandée à moi nommément ; sinon seulement à une de mes équipes */
  direct: boolean
  /** équipes demandées (noms affichés) */
  teams: string[]
  /** j'ai déjà reviewé : la demande est une re-request */
  rerequest: boolean
  /** date de la dernière demande qui me vise (moi ou une équipe demandée) */
  since: string
}

/* ---------- Serveur MCP local ---------- */

/** Infos du binaire et du socket (commande Rust `mcp_info`). */
export type McpInfo = {
  /** binaire à lancer avec `--mcp` */
  exe: string
  socket: string | null
  /** false sous Windows : icône et page masquées */
  supported: boolean
}

/** Un appel reçu par le serveur MCP. Jamais le contenu de la réponse. */
export type McpCall = {
  at: string
  /** `clientInfo.name` annoncé par l'agent à l'`initialize` */
  client: string
  tool: string
  args: unknown
  ms: number
  ok: boolean
  error?: string
  /** taille de la réponse en octets */
  bytes: number
}

/** Version web locale : statut du serveur de l'app (src-tauri/src/web.rs). */
export type WebStatus = {
  enabled: boolean
  port: number
  running: boolean
  /** `port-busy`, ou message du système */
  error: string | null
}

/* ---------- Vue CI d'une PR (ouverte depuis la pastille CI) ---------- */

/** État d'un job normalisé depuis `CheckRun` (status + conclusion) ou `StatusContext`. */
export type CiState =
  | "success"
  | "failure"
  | "running"
  | "queued"
  | "skipped"
  | "cancelled"
  | "neutral"

/** Un job (check run) ou un statut de commit (CI hors Actions). */
export type CiJob = {
  name: string
  state: CiState
  startedAt: string | null
  completedAt: string | null
  /** page du job sur GitHub (`detailsUrl` ou `targetUrl`) */
  url: string | null
}

/** Une boîte de la vue CI : un workflow (check suite), ou les statuts de commit. */
export type CiWorkflow = {
  /** clé de liste stable */
  key: string
  /** nom du workflow, de l'app GitHub, ou null pour les statuts de commit */
  name: string | null
  /** fichier du workflow (`ci.yml`) */
  file: string | null
  /** déclencheur (`pull_request`) */
  event: string | null
  /** id du workflow run GitHub Actions : relance des jobs en échec */
  runId: number | null
  jobs: CiJob[]
  /** jobs au-delà de la borne de la requête : non affichés */
  hiddenJobs: number
}

/** Vue CI d'une PR ; `moreChecks` : check suites au-delà de la borne de la requête (nombre inconnu de workflows :
 * des apps n'y déclarent qu'une suite vide, masquée). */
export type CiView = { workflows: CiWorkflow[]; moreChecks: boolean }
