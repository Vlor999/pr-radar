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
  comments: { author: string; body: string; url: string; at: string }[]
}

/** Commentaire général de la PR ou texte d'une review ; `state` : celui de la review. */
export type Note = Thread["comments"][number] & { state?: string }

export type Pr = {
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
  ci: string | null
  comments: number
  unresolved: number
  threads: Thread[]
  /** derniers commentaires généraux et textes de review, du plus ancien au plus récent */
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
