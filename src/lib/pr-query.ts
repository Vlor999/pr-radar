/** Requête GraphQL des PR ouvertes : logique pure, sans Tauri. */
import { GITHUB } from "./accounts.ts"

const PAGE_SIZE = 20 // le coût GraphQL suit les bornes demandées, pas les nœuds renvoyés : 20 × 50 fils × 20 messages ≈ 21 points (103 avec 50 × 100 × 50)

const QUERY = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: ${PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number title url isDraft updatedAt mergeable reviewDecision headRefName baseRefName additions deletions changedFiles
      repository { nameWithOwner }
      comments(first: 100) { nodes { author { login } } }
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
// stacks natifs (preview GitHub.com, juillet 2026) : champ absent du schéma GHES, la requête y échouerait
const STACK = "stackEntry { position stack { number size } }"
export const queryFor = (host: string) =>
  QUERY.replace("STACK", host === GITHUB ? STACK : "")
