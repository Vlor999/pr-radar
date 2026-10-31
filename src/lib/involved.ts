/** PR des autres qui me concernent, dans l'arbre « PR ouvertes » : logique pure, sans Tauri. */
import type { Reason } from "./types.ts"

/** Champs lus pour classer une PR (auteur, assignés) ; logins tels que GitHub les renvoie. */
export type Roles = { author: string | null; assignees: string[] }

const same = (a: string | null, b: string) =>
  !!a && a.toLowerCase() === b.toLowerCase()

/** PR dont je suis l'auteur ou un assigné : son motif se lit sans la recherche des mentions. */
export const knownWithoutMentions = (p: Roles, login: string) =>
  same(p.author, login) || p.assignees.some((a) => same(a, login))

/**
 * Motif d'une PR remontée par `involves:@me` : null si elle est à moi, sinon assignée > mentionné > impliqué
 * (`involves` = auteur, assigné, mentionné ou commentateur : ce qui reste est un commentaire ou une review).
 */
export const reasonOf = (
  p: Roles,
  login: string,
  mentioned: boolean,
): Reason | null =>
  same(p.author, login)
    ? null
    : p.assignees.some((a) => same(a, login))
      ? "assigned"
      : mentioned
        ? "mentioned"
        : "involved"

/** Une PR une seule fois (pages de recherche décalées entre deux appels), première occurrence gardée. */
export const uniqueById = <T extends { id: string }>(xs: T[]) => {
  const seen = new Set<string>()
  return xs.filter((x) => !seen.has(x.id) && !!seen.add(x.id))
}

/**
 * Ids des PR où je suis mentionné, parmi `prs`. `search` (recherche `mentions:@me`) n'est lancée que s'il reste
 * une PR d'un autre où je ne suis pas assigné ; en échec, aucun id : la pastille dit « Impliqué » au lieu de
 * « Mentionné », sans faire échouer tout le compte. Un jeton refusé (`AuthError`) rejette quand même.
 */
export const mentionedIds = async (
  prs: Roles[],
  login: string,
  search: () => Promise<{ id: string }[]>,
): Promise<Set<string>> => {
  if (prs.every((p) => knownWithoutMentions(p, login))) return new Set()
  // jeton refusé : remonte (retour à la connexion) ; autre échec : aucun id
  const found = await search().catch((e: unknown) => {
    if (e instanceof Error && e.name === "AuthError") throw e
    return []
  })
  return new Set(found.map((m) => m.id))
}
