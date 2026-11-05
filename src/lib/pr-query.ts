/** Requête GraphQL des PR ouvertes : logique pure, sans Tauri. */
import { GITHUB } from "./accounts.ts"
import {
  CONVERSATION_MAX,
  PR_EVENTS_MAX,
  PROBE_PAGE_SIZE,
} from "./constants.ts"
import { isBot } from "./timeline.ts"
import type { Note, Pr, PrEvent } from "./types.ts"

/** Champs d'une PR affichée ; `STACK` et `EVENTS` remplacés par `queryFor`. */
const PR_FIELDS = `
      id number title url isDraft createdAt updatedAt mergeable viewerCanUpdateBranch reviewDecision headRefName baseRefName additions deletions changedFiles
      repository { nameWithOwner }
      isCrossRepository author { login __typename } assignees(first: 10) { nodes { login } }
      comments(first: 100) { nodes { author { login } } }
      conversation: comments(last: ${CONVERSATION_MAX}) { nodes { author { login } bodyHTML url createdAt } }
      reviews(last: 30) { nodes { author { login } state bodyHTML url submittedAt comments { totalCount } } }
      EVENTS
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
  createdAt: string
  author: { login: string; __typename?: string } | null
  reviews: {
    nodes: {
      author: { login: string } | null
      state: string
      submittedAt: string | null
      url: string
      comments: { totalCount: number }
    }[]
  }
  /** absent : champ refusé par le serveur (GitHub Enterprise ancien), voir `withEventsFallback` */
  events?: {
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
export const toPrEvents = ({
  reviews,
  events,
}: Pick<RawPrEvents, "reviews" | "events">): PrEvent[] =>
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
    ...(events?.nodes ?? []).flatMap((e): PrEvent[] =>
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

/** Champs de la vue Fil d'une PR ouverte : ouverture, auteur (robot ou non), reviews et événements. */
export const timelineFields = (
  p: RawPrEvents,
): Pick<Pr, "createdAt" | "author" | "bot" | "events"> => ({
  createdAt: p.createdAt,
  author: p.author?.login ?? "ghost",
  ...(isBot(p.author) && { bot: true }),
  events: toPrEvents(p),
})

// événements de la vue Fil : un GitHub Enterprise ancien peut refuser un type d'`itemTypes`
const EVENTS = `events: timelineItems(last: ${PR_EVENTS_MAX}, itemTypes: [READY_FOR_REVIEW_EVENT, CLOSED_EVENT, REOPENED_EVENT]) { nodes {
        __typename
        ... on ReadyForReviewEvent { actor { login } createdAt }
        ... on ClosedEvent { actor { login } createdAt }
        ... on ReopenedEvent { actor { login } createdAt } } }`

// stacks natifs (preview GitHub.com, juillet 2026) : champ absent du schéma GHES, la requête y échouerait
const STACK = "stackEntry { position stack { number size } }"
/** `withoutStack`, `withoutEvents` : GitHub a déjà refusé ce champ pour ce compte. */
export const queryFor = (
  host: string,
  withoutStack = false,
  kind: QueryKind = "nodes",
  withoutEvents = false,
) =>
  QUERIES[kind]
    .replace("STACK", host === GITHUB && !withoutStack ? STACK : "")
    .replace("EVENTS", withoutEvents ? "" : EVENTS)
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
  withoutEvents = false,
): Promise<T> =>
  run(queryFor(host, skip, kind, withoutEvents)).catch((e: unknown) => {
    if (skip || !isStackFieldError(e)) throw e
    onRefused()
    return run(queryFor(host, true, kind, withoutEvents))
  })

// erreurs de validation du schéma (graphql-ruby, GitHub.com et GHES) sur le champ, son argument ou ses fragments
const EVENT_TYPES = "(?:ReadyForReviewEvent|ClosedEvent|ReopenedEvent)"
const EVENTS_FIELD_ERRORS = [
  /Field 'timelineItems' doesn't exist on type/,
  /Field 'timelineItems' doesn't accept argument 'itemTypes'/,
  /Argument 'itemTypes' on Field 'timelineItems' has an invalid value/,
  new RegExp(
    `No such type ${EVENT_TYPES}, so it can't be a fragment condition`,
  ),
  new RegExp(`Fragment on ${EVENT_TYPES} can't be spread inside`),
]
/**
 * Erreur de validation GraphQL sur les événements de la vue Fil (champ, argument ou type d'événement inconnu du
 * serveur). Une autre erreur qui les nomme (délai, erreur serveur) n'est pas un refus : pas de repli pour la session.
 */
export const isEventsFieldError = (e: unknown) =>
  e instanceof Error && EVENTS_FIELD_ERRORS.some((r) => r.test(e.message))

/**
 * Lance `run` avec les événements de la vue Fil, sauf si `skip` ; si GitHub les refuse, appelle `onRefused` et
 * relance une fois sans : les PR de ce compte gardent leurs reviews dans le fil, sans « prête », fermeture, réouverture.
 */
export const withEventsFallback = <T>(
  skip: boolean,
  run: (withoutEvents: boolean) => Promise<T>,
  onRefused: () => void,
): Promise<T> =>
  run(skip).catch((e: unknown) => {
    if (skip || !isEventsFieldError(e)) throw e
    onRefused()
    return run(true)
  })
