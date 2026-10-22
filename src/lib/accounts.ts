/** Comptes GitHub connectés (github.com ou GitHub Enterprise Server) : logique pure, sans Tauri. */
export type AuthSource = "oauth" | "pat" | "gh"
export type Account = {
  /** clé du trousseau et préfixe des repos suivis */
  id: string
  /** `github.com` ou l'hôte GitHub Enterprise (`ghe.example.com`) */
  host: string
  source: AuthSource
  login?: string
}

export const GITHUB = "github.com"
/** Compte github.com d'origine : son entrée du trousseau et ses repos suivis (sans préfixe) ne changent pas. */
export const DEFAULT_ID = "github"

export const apiUrl = (host: string) =>
  host === GITHUB ? "https://api.github.com" : `https://${host}/api/v3`
export const graphqlUrl = (host: string) =>
  host === GITHUB
    ? "https://api.github.com/graphql"
    : `https://${host}/api/graphql`

// même règle que `valid_host` côté Rust : nom d'hôte en minuscules, port optionnel
const HOST =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/

/** `https://GHE.example.com/` → `ghe.example.com` ; null si ce n'est pas un nom d'hôte. */
export function normalizeHost(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, "")
    .replace(/\/+$/, "")
  return HOST.test(host) ? host : null
}

/** Comptes enregistrés ; avant le multi-compte, le compte unique d'origine (jeton sous `github`). */
export const savedAccounts = (
  saved: Account[] | null,
  legacySource: AuthSource | null,
): Account[] =>
  saved ?? [{ id: DEFAULT_ID, host: GITHUB, source: legacySource ?? "pat" }]

export const newAccountId = (
  accounts: Account[],
  host: string,
  login: string,
) =>
  host === GITHUB && !accounts.some((a) => a.id === DEFAULT_ID)
    ? DEFAULT_ID
    : `${login}@${host}`

/** Clé d'un repo suivi : `owner/name` pour le compte d'origine, `<compte>:owner/name` sinon. */
export const repoKey = (account: string, name: string) =>
  account === DEFAULT_ID ? name : `${account}:${name}`

export function splitKey(key: string): { account: string; name: string } {
  // un nom de repo n'a jamais de « : » ; l'id d'un compte peut en avoir un (port)
  const i = key.lastIndexOf(":")
  return i < 0
    ? { account: DEFAULT_ID, name: key }
    : { account: key.slice(0, i), name: key.slice(i + 1) }
}

/** Repos suivis groupés par compte connecté ; ceux d'un compte absent sont ignorés. */
export const byAccount = (keys: string[], accounts: Account[]) =>
  accounts
    .map((a): [Account, string[]] => [
      a,
      keys
        .map(splitKey)
        .filter((k) => k.account === a.id)
        .map((k) => k.name),
    ])
    .filter(([, names]) => names.length > 0)

/** Au démarrage : lecture du trousseau par compte (`undefined` = lecture en échec, pas « aucun jeton »). */
export function sortReads(reads: [Account, string | null | undefined][]) {
  return {
    /** jeton lu : compte utilisable */
    live: reads.filter(([, t]) => t).map(([a]) => a),
    /** lecture en échec (trousseau verrouillé, refus) : gardé dans la liste enregistrée, inutilisé */
    kept: reads.filter(([, t]) => t === undefined).map(([a]) => a),
  }
}

/** Liste à enregistrer : comptes connectés, puis ceux dont la lecture a échoué (sans doublon d'id). */
export const toPersist = (live: Account[], kept: Account[]) => [
  ...live,
  ...kept.filter((k) => !live.some((a) => a.id === k.id)),
]

export type AccountError = { account: Account; error: unknown }

/**
 * Une tâche par compte : un compte en échec n'empêche pas les autres d'être affichés.
 * Tous en échec : la première erreur est levée, comme avec un seul compte.
 */
export async function settle<T>(
  accounts: Account[],
  run: (a: Account) => Promise<T[]>,
): Promise<{ data: T[]; errors: AccountError[] }> {
  const results = await Promise.allSettled(accounts.map(run))
  const errors = results.flatMap((r, i) =>
    r.status === "rejected" ? [{ account: accounts[i], error: r.reason }] : [],
  )
  if (errors.length && errors.length === accounts.length) throw errors[0].error
  return {
    data: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    errors,
  }
}

/** Relance `run` jusqu'à `retries` fois tant qu'il renvoie une liste vide. */
export async function retryEmpty<T>(
  retries: number,
  run: () => Promise<T[]>,
): Promise<T[]> {
  const out = await run()
  return out.length || retries <= 0 ? out : retryEmpty(retries - 1, run)
}

/** Message des comptes en échec, chacun nommé : `me (ghe.example.com) : HTTP 502`. */
export const describeErrors = (errors: AccountError[]) =>
  errors
    .map(({ account: a, error }) => {
      const who = a.login ? `${a.login} (${a.host})` : a.host
      return `${who} : ${error instanceof Error ? error.message : String(error)}`
    })
    .join(" ; ")
