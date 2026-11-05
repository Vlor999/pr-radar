/** Requête GraphQL des PR ouvertes : logique pure, sans Tauri. */
import { GITHUB } from "./accounts.ts"
import { PR_EVENTS_MAX, PROBE_PAGE_SIZE } from "./constants.ts"
import type { Note, PrEvent } from "./types.ts"

/** Champs d'une PR affichée ; `STACK` remplacé par `queryFor`. */
const PR_FIELDS = `
      id number title url isDraft createdAt updatedAt mergeable viewerCanUpdateBranch reviewDecision headRefName baseRefName additions deletions changedFiles
      repository { nameWithOwner }
      isCrossRepository author { login __typename } assignees(first: 10) { nodes { login } }
      comments(first: 100) { nodes { author { login } } }
      conversation: comments(last: 10) { nodes { author { login } bodyHTML url createdAt } }
      reviews(last: 30) { nodes { author { login } state bodyHTML url submittedAt comments { totalCount } } }
      events: timelineItems(last: ${PR_EVENTS_MAX}, itemTypes: [READY_FOR_REVIEW_EVENT, CLOSED_EVENT, REOPENED_EVENT]) { nodes {
        __typename
        ... on ReadyForReviewEvent { actor { login } createdAt }
        ... on ClosedEvent { actor { login } createdAt }
        ... on ReopenedEvent { actor { login } createdAt } } }
      reviewThreads(first: 50) { nodes { id isResolved isOutdated path line
        hunk: comments(first: 1) { nodes { diffHunk } }
        comments(first: 20) { nodes { author { login } bodyHTML url createdAt } } } }
      latestOpinionatedReviews(first: 20) { nodes { author { login } state } }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
      STACK`

/**
 * Lecture complète de PR connues par leur id. Coût proportionnel au nombre d'ids (mesuré : 1 id = 1 point,
 * 20 ids = 22 points), quand une page de recherche paie ses 20 places même à moitié vide.
 */
const NODES_QUERY = `
query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on PullRequest { ${PR_FIELDS} } }
}`

/**
 * Sondage : empreinte de chaque PR ouverte, 1 point par page de ${PROBE_PAGE_SIZE} (mesuré).
 * `updatedAt` ne suffit pas : CI, mergeabilité, branche en retard et reviews d'une GitHub App (Copilot, Vercel)
 * ne le changent pas ; une résolution de fil n'a pas de date lisible. Ces champs sont donc lus ici.
 */
const PROBE_QUERY = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: ${PROBE_PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      id updatedAt mergeable viewerCanUpdateBranch reviewDecision
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
      reviewThreads(first: 50) { nodes { isResolved } }
      latestOpinionatedReviews(first: 20) { nodes { author { login } state } }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
      reviews { totalCount } comments { totalCount }
      STACK
    } }
  }
}`
const QUERIES = { nodes: NODES_QUERY, probe: PROBE_QUERY }
export type QueryKind = keyof typeof QUERIES

type RawNote = {
  author: { login: string } | null
  bodyHTML: string
  url: string
}
export type RawConversation = {
  conversation: { nodes: (RawNote & { createdAt: string })[] }
  reviews: {
    nodes: (RawNote & { state: string; submittedAt: string | null })[]
  }
}

/** Champs de la vue Fil lus avec chaque PR ouverte. */
export type RawPrEvents = {
  reviews: {
    nodes: {
      author: { login: string } | null
      state: string
      submittedAt: string | null
      url: string
      comments: { totalCount: number }
    }[]
  }
  events: {
    nodes: ({
      __typename: "ReadyForReviewEvent" | "ClosedEvent" | "ReopenedEvent"
      actor: { login: string } | null
      createdAt: string
    } | null)[]
  }
}

const EVENT_KINDS = {
  ReadyForReviewEvent: "ready",
  ClosedEvent: "close",
  ReopenedEvent: "reopen",
} as const

/** Reviews envoyées (avec ou sans texte) et événements « prête », fermeture, réouverture, par date. */
export const toPrEvents = ({ reviews, events }: RawPrEvents): PrEvent[] =>
  [
    ...reviews.nodes
      .filter((r) => r.submittedAt && r.state !== "PENDING")
      .map((r): PrEvent => ({
        kind: "review",
        who: r.author?.login ?? "ghost",
        at: r.submittedAt!,
        review: r.state,
        threads: r.comments.totalCount,
        url: r.url,
      })),
    ...events.nodes.flatMap((e): PrEvent[] =>
      e && e.__typename in EVENT_KINDS
        ? [
            {
              kind: EVENT_KINDS[e.__typename],
              who: e.actor?.login ?? "ghost",
              at: e.createdAt,
            },
          ]
        : [],
    ),
  ].sort((a, b) => a.at.localeCompare(b.at))

/** Commentaires généraux et textes de review, du plus ancien au plus récent (review sans texte ou non envoyée ignorée). */
export const toConversation = ({
  conversation,
  reviews,
}: RawConversation): Note[] =>
  [
    ...conversation.nodes.map((c) => ({ c, at: c.createdAt })),
    ...reviews.nodes
      .filter((r) => r.bodyHTML.trim() && r.submittedAt)
      .map((r) => ({ c: r, at: r.submittedAt!, state: r.state })),
  ]
    .map(({ c, ...n }) => ({
      author: c.author?.login ?? "ghost",
      body: c.bodyHTML,
      url: c.url,
      ...n,
    }))
    .sort((a, b) => a.at.localeCompare(b.at))

// stacks natifs (preview GitHub.com, juillet 2026) : champ absent du schéma GHES, la requête y échouerait
const STACK = "stackEntry { position stack { number size } }"
/** `withoutStack` : GitHub a déjà refusé le champ pour ce compte. */
export const queryFor = (
  host: string,
  withoutStack = false,
  kind: QueryKind = "nodes",
) =>
  QUERIES[kind].replace("STACK", host === GITHUB && !withoutStack ? STACK : "")
/** Erreur de validation GraphQL sur le champ des stacks natifs (preview retirée, compte sans accès). */
export const isStackFieldError = (e: unknown) =>
  e instanceof Error && e.message.includes("stackEntry")

/**
 * Lance `run` avec les stacks natifs, sauf si `skip` ; si GitHub refuse `stackEntry`,
 * appelle `onRefused` et relance une fois sans le champ.
 */
export const withStackFallback = <T>(
  host: string,
  skip: boolean,
  run: (query: string) => Promise<T>,
  onRefused: () => void,
  kind: QueryKind = "nodes",
): Promise<T> =>
  run(queryFor(host, skip, kind)).catch((e: unknown) => {
    if (skip || !isStackFieldError(e)) throw e
    onRefused()
    return run(queryFor(host, true, kind))
  })
