/** Lecture d'une réponse GraphQL : logique pure, sans Tauri. */
export type GqlResponse = {
  data?: Record<string, unknown> | null
  errors?: { message: string }[]
}

/**
 * Échec si `data` manque, ou si `errors` accompagne un champ racine null (mutation refusée).
 * Un champ racine nullable (`repository(...)`) null + errors échoue aussi, avec le message de GitHub.
 * GitHub renvoie des données partielles quand un repo d'org est inaccessible (SSO, restriction) : on les garde.
 */
export const gqlFailed = ({ data, errors }: GqlResponse) =>
  !data || (!!errors?.length && Object.values(data).some((v) => v === null))
