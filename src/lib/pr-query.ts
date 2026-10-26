/** Requête GraphQL des PR ouvertes : logique pure, sans Tauri. */
import { GITHUB } from "./accounts.ts"
import type { Note } from "./types.ts"

const PAGE_SIZE = 20 // le coût GraphQL suit les bornes demandées, pas les nœuds renvoyés : 20 × 50 fils × 20 messages ≈ 21 points (103 avec 50 × 100 × 50) ; les connexions propres à chaque PR (commentaires, reviews…) ajoutent ~1 point

const QUERY = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: ${PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number title url isDraft updatedAt mergeable reviewDecision headRefName baseRefName additions deletions changedFiles
      repository { nameWithOwner }
      comments(first: 100) { nodes { author { login } } }
      conversation: comments(last: 10) { nodes { author { login } bodyText url createdAt } }
      reviews(last: 30) { nodes { author { login } state bodyText url submittedAt } }
      reviewThreads(first: 50) { nodes { id isResolved isOutdated path line
        hunk: comments(first: 1) { nodes { diffHunk } }
        comments(first: 20) { nodes { author { login } bodyText url createdAt } } } }
      latestOpinionatedReviews(first: 20) { nodes { author { login } state } }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      STACK
    } }
  }
}`
type RawNote = {
  author: { login: string } | null
  bodyText: string
  url: string
}
export type RawConversation = {
  conversation: { nodes: (RawNote & { createdAt: string })[] }
  reviews: {
    nodes: (RawNote & { state: string; submittedAt: string | null })[]
  }
}

/** Commentaires généraux et textes de review, du plus ancien au plus récent (review sans texte ou non envoyée ignorée). */
export const toConversation = ({
  conversation,
  reviews,
}: RawConversation): Note[] =>
  [
    ...conversation.nodes.map((c) => ({ c, at: c.createdAt })),
    ...reviews.nodes
      .filter((r) => r.bodyText.trim() && r.submittedAt)
      .map((r) => ({ c: r, at: r.submittedAt!, state: r.state })),
  ]
    .map(({ c, ...n }) => ({
      author: c.author?.login ?? "ghost",
      body: c.bodyText,
      url: c.url,
      ...n,
    }))
    .sort((a, b) => a.at.localeCompare(b.at))

// stacks natifs (preview GitHub.com, juillet 2026) : champ absent du schéma GHES, la requête y échouerait
const STACK = "stackEntry { position stack { number size } }"
/** `withoutStack` : GitHub a déjà refusé le champ pour ce compte. */
export const queryFor = (host: string, withoutStack = false) =>
  QUERY.replace("STACK", host === GITHUB && !withoutStack ? STACK : "")
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
): Promise<T> =>
  run(queryFor(host, skip)).catch((e: unknown) => {
    if (skip || !isStackFieldError(e)) throw e
    onRefused()
    return run(queryFor(host, true))
  })
