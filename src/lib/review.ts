/** Onglet « À reviewer » : PR des autres qui attendent ma review. Logique pure, sans réseau. */
import { repoKey, splitKey } from "./accounts.ts"
import type { Decision, ReviewPr } from "./types"

type Reviewer = { login?: string; name?: string } | null

export type RawReview = {
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  reviewDecision: Decision
  author: { login: string } | null
  repository: { nameWithOwner: string }
  viewerLatestReview: { state: string } | null
  reviewRequests: { nodes: { requestedReviewer: Reviewer }[] }
  timelineItems: {
    nodes: { createdAt?: string; requestedReviewer?: Reviewer }[]
  }
}

export function toReview(
  p: RawReview,
  login: string,
  account: string,
): ReviewPr {
  const reviewers = p.reviewRequests.nodes.map((n) => n.requestedReviewer)
  const direct = reviewers.some((r) => r?.login === login)
  const teams = reviewers.flatMap((r) => (r?.name ? [r.name] : []))
  // dernière demande qui me vise, moi ou une équipe encore demandée ; sinon la création de la PR
  const since = p.timelineItems.nodes
    .filter(({ requestedReviewer: r }) =>
      direct ? r?.login === login : !!r?.name && teams.includes(r.name),
    )
    .reduce((at, e) => (e.createdAt && e.createdAt > at ? e.createdAt : at), "")
  return {
    repo: repoKey(account, p.repository.nameWithOwner),
    number: p.number,
    title: p.title,
    url: p.url,
    author: p.author?.login ?? "ghost",
    draft: p.isDraft,
    decision: p.reviewDecision,
    direct,
    teams,
    // une review en cours (PENDING) n'est pas encore envoyée
    rerequest:
      !!p.viewerLatestReview && p.viewerLatestReview.state !== "PENDING",
    since: since || p.createdAt,
  }
}

export type Who = "all" | "me" | "team"

/** Chips Tout / Moi / Équipe et « Masquer déjà approuvées » (demandes d'équipe déjà approuvées). */
export const filterReviews = (
  prs: ReviewPr[],
  who: Who,
  hideApproved: boolean,
) =>
  prs.filter(
    (p) =>
      (who === "all" || p.direct === (who === "me")) &&
      !(hideApproved && !p.direct && p.decision === "APPROVED"),
  )

/** Compteur de l'onglet : demandes nominatives à moi, hors drafts. */
export const reviewCount = (prs: ReviewPr[]) =>
  prs.filter((p) => p.direct && !p.draft).length

/** Groupes par repo, la demande la plus ancienne d'abord (dans le groupe et entre groupes). */
export function groupByRepo(prs: ReviewPr[]): [string, ReviewPr[]][] {
  const groups = new Map<string, ReviewPr[]>()
  for (const p of [...prs].sort((a, b) => a.since.localeCompare(b.since)))
    groups.set(p.repo, [...(groups.get(p.repo) ?? []), p])
  return [...groups]
}

export const reviewKey = (p: ReviewPr) => `${p.repo}#${p.number}`

/** Demandes connues : comptes dont la liste est à jour (ou gardée), et PR de ces comptes. */
export type Reviews = { accounts: string[]; reviews: ReviewPr[] }

const accountOf = (p: ReviewPr) => splitKey(p.repo).account

/**
 * Nouveau chargement : les comptes en échec gardent leurs PR précédentes (pas de re-notification à leur
 * retour) ; un compte jamais lu avec succès reste inconnu.
 */
export function mergeReviews(
  prev: Reviews,
  data: ReviewPr[],
  queried: string[],
  failed: string[],
): Reviews {
  const kept = prev.accounts.filter((a) => failed.includes(a))
  return {
    accounts: [...queried.filter((a) => !failed.includes(a)), ...kept],
    reviews: [
      ...data,
      ...prev.reviews.filter((p) => kept.includes(accountOf(p))),
    ],
  }
}

/** Ce qui sert à comparer deux chargements : une PR passée d'équipe à moi devient une demande nouvelle. */
export const snapshot = ({ accounts, reviews }: Reviews) => ({
  accounts,
  direct: new Set(reviews.filter((p) => p.direct).map(reviewKey)),
})

/**
 * Demandes nominatives apparues depuis le chargement précédent (une re-request réapparaît après ma review).
 * Compte absent du chargement précédent (ajouté, jamais lu) : son arriéré n'est pas signalé.
 */
export const newRequests = (
  before: ReturnType<typeof snapshot>,
  now: ReviewPr[],
) =>
  now.filter(
    (p) =>
      p.direct &&
      before.accounts.includes(accountOf(p)) &&
      !before.direct.has(reviewKey(p)),
  )
