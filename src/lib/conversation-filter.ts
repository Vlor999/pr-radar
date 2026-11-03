// extension : chargé aussi par node --test
import { fold, foldQuery } from "./settings-search.ts"
import type { SlackConversation } from "./types.ts"

/** Choix des conversations Slack surveillées (réglages) : types, compteurs, recherche, filtres. */

/** `channel` : channels publics et privés. */
export type ConvType = "channel" | "im" | "mpim"
export type ConvFilter = "all" | "selected" | ConvType

export const convType = (c: Pick<SlackConversation, "kind">): ConvType =>
  c.kind === "public" || c.kind === "private" ? "channel" : c.kind

/** Cochées (parmi la liste lue) et nombre par type. */
export function convCounts(
  convs: SlackConversation[],
  selected: readonly string[],
): Record<"selected" | ConvType, number> {
  const ids = new Set(selected)
  const out = { selected: 0, channel: 0, im: 0, mpim: 0 }
  for (const c of convs) {
    out[convType(c)]++
    if (ids.has(c.id)) out.selected++
  }
  return out
}

/** Recherche : nom affiché et, pour un DM, noms Slack et identifiant ; casse, accents, `@` / `#` initial ignorés. */
export const matchesConv = (c: SlackConversation, query: string) => {
  const q = foldQuery(query)
  return (
    !q ||
    [c.name, ...(c.contact?.names ?? []), c.contact?.handle ?? ""].some((s) =>
      fold(s).includes(q),
    )
  )
}

/** Conversations affichées, dans l'ordre de la liste (une ligne cochée ne bouge pas). */
export const filterConversations = (
  convs: SlackConversation[],
  query: string,
  filter: ConvFilter,
  selected: readonly string[],
) =>
  convs.filter(
    (c) =>
      (filter === "all" ||
        (filter === "selected"
          ? selected.includes(c.id)
          : convType(c) === filter)) &&
      matchesConv(c, query),
  )

/** Cochées après « tout cocher » / « tout décocher » sur les conversations affichées, sans doublon. */
export const withShown = (
  selected: readonly string[],
  shown: SlackConversation[],
  on: boolean,
) => {
  const ids = new Set(shown.map((c) => c.id))
  return on
    ? [...new Set([...selected, ...ids])]
    : selected.filter((id) => !ids.has(id))
}
