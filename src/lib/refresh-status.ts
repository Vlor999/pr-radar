/** Issue d'une actualisation, montrée par la pastille à côté du bouton « Rafraîchir ». */
export type RefreshStatus = "ok" | "partial" | "failed"

/**
 * `failed` : lecture des PR en échec pour tous les comptes interrogés. `partial` : une partie des
 * comptes, une recherche de reviews ou la lecture des PR mergées en échec, le reste chargé. `ok` sinon.
 * L'échec global levé par `reload` (réseau, jeton refusé) ne passe pas par ici : `failed` d'office.
 */
export function refreshStatus({
  accounts,
  prErrors,
  reviewErrors,
  mergedError,
}: {
  accounts: string[]
  /** comptes dont la lecture des PR a échoué */
  prErrors: string[]
  /** comptes dont la recherche des reviews a échoué */
  reviewErrors: string[]
  mergedError?: string
}): RefreshStatus {
  const failed = new Set(prErrors)
  if (accounts.length && accounts.every((a) => failed.has(a))) return "failed"
  return failed.size || reviewErrors.length || mergedError ? "partial" : "ok"
}
