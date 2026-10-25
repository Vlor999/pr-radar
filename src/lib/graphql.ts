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
