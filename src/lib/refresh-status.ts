/** Issue d'une actualisation, montrée par la pastille à côté du bouton « Rafraîchir ». */
export type RefreshStatus = "ok" | "partial" | "failed"

/**
 * `failed` : tous les comptes interrogés en échec. `partial` : une partie des comptes,
 * ou la lecture des PR mergées, en échec, le reste chargé. `ok` sinon.
 * L'échec global levé par `reload` (réseau, jeton refusé) ne passe pas par ici : `failed` d'office.
 */
export function refreshStatus({
  accounts,
  failedAccounts,
  mergedError,
}: {
  accounts: string[]
  failedAccounts: string[]
  mergedError?: string
}): RefreshStatus {
  const failed = new Set(failedAccounts)
  if (accounts.length && accounts.every((a) => failed.has(a))) return "failed"
  return failed.size || mergedError ? "partial" : "ok"
}
