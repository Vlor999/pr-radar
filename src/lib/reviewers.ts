import type { Pr, SlackMention, SlackRecipient } from "./types.ts"

/** `name` : nom complet du profil GitHub (absent ou null s'il n'est pas renseigné). */
export type Reviewer = { login: string; id: string; name?: string | null }

/** Candidat du popover ; `slack` : destinataire d'un DM Slack 1:1 qui cite la PR. */
export type Candidate = Reviewer & { slack?: boolean }

/** Reviewer demandé depuis l'app, affiché avant que le rechargement ne le confirme ;
 * `sentAt` : acceptation par GitHub (ms), `null` tant que la demande est en cours. */
export type PendingReview = { login: string; sentAt: number | null }

/** Nom comparable : casse, accents, espaces et ponctuation ignorés (`Élodie D.` → `elodied`). */
export const normalizeName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")

/** Destinataires des DM 1:1 que j'ai envoyés avec le lien de la PR, sans doublon. */
export const dmRecipients = (mentions: SlackMention[]): SlackRecipient[] => [
  ...new Map(
    mentions.flatMap((m) =>
      m.recipient ? [[m.recipient.id, m.recipient]] : [],
    ),
  ).values(),
]

/**
 * Utilisateurs GitHub dont le login ou le nom correspond exactement (après `normalizeName`) à un nom
 * Slack d'un destinataire. Pas de correspondance partielle : un prénom seul ne propose personne.
 */
export function matchRecipients(
  recipients: SlackRecipient[],
  users: Reviewer[],
): Reviewer[] {
  const out = new Map<string, Reviewer>()
  for (const r of recipients) {
    const names = new Set(r.names.map(normalizeName).filter(Boolean))
    for (const u of users) {
      const keys = [u.login, u.name ?? ""].map(normalizeName)
      if (keys.some((k) => names.has(k))) out.set(u.login.toLowerCase(), u)
    }
  }
  return [...out.values()]
}

/**
 * Candidats reviewers d'une PR : destinataires de DM Slack, puis suggestions GitHub, puis utilisateurs
 * assignables, sans doublon (casse ignorée) ni login exclu (moi, l'auteur, les reviews déjà demandées).
 */
export function reviewerCandidates(
  suggested: Reviewer[],
  assignable: Reviewer[],
  exclude: string[],
  fromSlack: Reviewer[] = [],
): Candidate[] {
  const seen = new Set(exclude.map((l) => l.toLowerCase()))
  return [
    ...fromSlack.map((u) => ({ ...u, slack: true })),
    ...suggested,
    ...assignable,
  ].filter(({ login }) => {
    const k = login.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Reviews demandées de la carte : celles de GitHub, puis celles envoyées et pas encore relues (sans doublon). */
export const withPending = (
  requested: Pr["requested"],
  pending: PendingReview[],
): Pr["requested"] => [
  ...requested,
  ...pending
    .filter(
      (p) =>
        !requested.some(
          (r) => !r.team && r.who.toLowerCase() === p.login.toLowerCase(),
        ),
    )
    .map((p) => ({ who: p.login })),
]

/** Demandes encore à afficher après un chargement lancé à `startedAt` : celles en cours ou acceptées après
 * son départ (pas encore lues sur GitHub). Un chargement plus ancien, dépassé, n'efface rien. */
export function settledPending(
  pending: Record<string, PendingReview[]>,
  startedAt: number,
): Record<string, PendingReview[]> {
  const out: Record<string, PendingReview[]> = {}
  for (const [url, list] of Object.entries(pending)) {
    const left = list.filter((p) => p.sentAt === null || p.sentAt >= startedAt)
    if (left.length) out[url] = left
  }
  return out
}

/** Noms Slack des destinataires à chercher sur GitHub, sans doublon une fois normalisés. */
export const dmNames = (recipients: SlackRecipient[]) => [
  ...new Map(
    recipients.flatMap((r) => r.names).map((n) => [normalizeName(n), n]),
  ).values(),
]

/** Destinataires dont aucun nom ne correspond déjà à un login connu (reviewer, review demandée) : seuls
 * ceux-là justifient une recherche GitHub. */
export const unresolvedRecipients = (
  recipients: SlackRecipient[],
  logins: string[],
) => {
  const known = logins.map((login) => ({ login, id: login }))
  return recipients.filter((r) => !matchRecipients([r], known).length)
}

/** Clé d'une suggestion écartée : la PR et le login GitHub (casse ignorée). */
export const dismissKey = (url: string, login: string) =>
  `${url}|${login.toLowerCase()}`

/** Suggestions écartées lues du stockage ; valeur absente ou invalide : aucune. */
export function parseDismissed(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]")
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : []
  } catch {
    return []
  }
}

/** Ajoute une suggestion écartée ; au-delà de `max`, les plus anciennes sont oubliées. */
export const addDismissed = (list: string[], key: string, max: number) =>
  [...list.filter((k) => k !== key), key].slice(-max)

/**
 * Reviewers fantômes de la carte : destinataires de DM rapprochés d'un utilisateur GitHub, sauf moi, ceux
 * qui ont déjà reviewé, les reviews demandées (sur GitHub ou en cours) et les suggestions écartées.
 */
export function ghostReviewers(
  matched: Reviewer[],
  pr: Pick<Pr, "url" | "reviews" | "requested">,
  pending: PendingReview[],
  dismissed: string[],
  viewer?: string,
): Reviewer[] {
  const taken = new Set(
    [
      ...(viewer ? [viewer] : []),
      ...pr.reviews.map((r) => r.who),
      ...pr.requested.filter((r) => !r.team).map((r) => r.who),
      ...pending.map((p) => p.login),
    ].map((l) => l.toLowerCase()),
  )
  return matched.filter(
    (u) =>
      !taken.has(u.login.toLowerCase()) &&
      !dismissed.includes(dismissKey(pr.url, u.login)),
  )
}
