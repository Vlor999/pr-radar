/** Onglet « À reviewer » : PR des autres qui attendent ma review. Logique pure, sans réseau. */
import { repoKey } from "./accounts.ts"
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

/** Demandes nominatives apparues depuis le chargement précédent (une re-request réapparaît après ma review). */
export const newRequests = (before: Set<string>, now: ReviewPr[]) =>
  now.filter((p) => p.direct && !before.has(reviewKey(p)))
