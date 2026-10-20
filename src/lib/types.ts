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
  additions: number
  deletions: number
  files: number
  reviews: { who: string; state: string }[]
  requested: string[]
  updated: string
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
