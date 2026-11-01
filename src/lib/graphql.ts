/** Lecture d'une réponse GraphQL : logique pure, sans Tauri. */
export type GqlResponse = {
  data?: Record<string, unknown> | null
  errors?: { message: string }[]
}

/**
 * Échec si `data` manque, ou si `errors` accompagne un champ racine null (mutation refusée).
 * Un champ racine nullable (`repository(...)`) null + errors échoue aussi, avec le message de GitHub.
 * Tous les champs racines comptent : avec plusieurs racines, une seule null + errors fait échouer toute la réponse.
 * GitHub renvoie des données partielles quand un repo d'org est inaccessible (SSO, restriction) : on les garde.
 */
export const gqlFailed = ({ data, errors }: GqlResponse) =>
  !data || (!!errors?.length && Object.values(data).some((v) => v === null))

/**
 * Ajoute `rateLimit { cost }` à une opération query (`query …` ou forme abrégée `{ … }`), au premier `{`
 * hors de l'en-tête des variables. Mutation inchangée : `rateLimit` n'existe que sur le type Query.
 */
export function withCost(query: string): string {
  const head = query.trimStart()
  if (!head.startsWith("{") && !/^query\b/.test(head)) return query
  let depth = 0 // parenthèses de l'en-tête `($q: String!)`
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]
    if (ch === "(") depth++
    else if (ch === ")") depth--
    else if (ch === "{" && depth === 0)
      return `${query.slice(0, i + 1)} rateLimit { cost }${query.slice(i + 1)}`
  }
  return query
}

/**
 * Retire de `data` le `rateLimit` ajouté par `withCost` (ni les appelants ni `gqlFailed` ne le voient)
 * et renvoie son coût en points ; undefined si absent ou null (GHES sans limite de débit).
 */
export function takeCost(json: GqlResponse): number | undefined {
  if (!json.data || !("rateLimit" in json.data)) return undefined
  const rl = json.data.rateLimit as { cost?: unknown } | null
  delete json.data.rateLimit
  const cost = rl?.cost
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? cost
    : undefined
}

/** Message d'échec : les erreurs de GitHub, sinon `fallback` (statut HTTP). */
export const gqlMessage = ({ errors }: GqlResponse, fallback: string) =>
  errors?.map((e) => e.message).join(" ; ") || fallback

export type RepoNode = {
  nameWithOwner: string
  isFork: boolean
  owner: { login: string; __typename: string }
}

/**
 * Même ensemble que REST `/user/repos?affiliation=owner,collaborator,organization_member` :
 * GraphQL y ajoute les forks de repos d'org possédés par d'autres utilisateurs ; les nœuds null (SSO) sont ignorés.
 * ponytail: règle mesurée (281 REST = 328 GraphQL - 47 forks d'autrui) ; un fork d'autrui où l'on est
 * collaborateur explicite serait perdu, refaire une requête `ownerAffiliations: [COLLABORATOR]` si ça compte.
 */
export const restRepos = (nodes: (RepoNode | null)[], login: string) =>
  nodes
    .filter(
      (n): n is RepoNode =>
        !!n &&
        !(n.isFork && n.owner.__typename === "User" && n.owner.login !== login),
    )
    .map((n) => n.nameWithOwner)
