import type { SlackMention, SlackRecipient } from "./types.ts"

/** `name` : nom complet du profil GitHub (absent ou null s'il n'est pas renseigné). */
export type Reviewer = { login: string; id: string; name?: string | null }

/** Candidat du popover ; `slack` : destinataire d'un DM Slack 1:1 qui cite la PR. */
export type Candidate = Reviewer & { slack?: boolean }

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
