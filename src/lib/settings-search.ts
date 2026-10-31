/** Réglage indexé pour la recherche des réglages, dans la langue de l'interface. */
export type SettingEntry<C extends string = string> = {
  /** id stable de la ligne (`setting-<id>` dans le DOM) */
  id: string
  category: C
  label: string
  description?: string
  /** mots en plus (libellés des boutons, synonymes) */
  keywords?: string
}

export type SettingResults<C extends string = string> = {
  /** résultats de la catégorie affichée, en premier */
  current: SettingEntry<C>[]
  /** autres catégories, dans l'ordre de l'index */
  others: { category: C; entries: SettingEntry<C>[] }[]
  count: number
}

/** Minuscules sans accents : « Échap » et « echap » se valent. */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()

/** 2 : tous les mots dans le libellé, 1 : dans libellé + description + mots-clés, 0 : absent. */
const score = (entry: SettingEntry, words: string[]) => {
  const label = fold(entry.label)
  if (words.every((w) => label.includes(w))) return 2
  const all = fold(
    `${entry.label} ${entry.description ?? ""} ${entry.keywords ?? ""}`,
  )
  return words.every((w) => all.includes(w)) ? 1 : 0
}

/** Réglages qui contiennent chaque mot de la requête : catégorie courante d'abord, libellés avant descriptions. */
export function searchSettings<C extends string>(
  index: SettingEntry<C>[],
  query: string,
  current: C,
): SettingResults<C> {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return { current: [], others: [], count: 0 }
  const hits = index
    .map((entry, i) => ({ entry, i, score: score(entry, words) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((h) => h.entry)
  const others = new Map<C, SettingEntry<C>[]>()
  // groupes dans l'ordre de l'index, pas dans celui des scores
  for (const e of index)
    if (e.category !== current && !others.has(e.category))
      others.set(e.category, [])
  for (const e of hits)
    if (e.category !== current) others.get(e.category)!.push(e)
  return {
    current: hits.filter((e) => e.category === current),
    others: [...others]
      .filter(([, entries]) => entries.length)
      .map(([category, entries]) => ({ category, entries })),
    count: hits.length,
  }
}

/** Résultats dans l'ordre d'affichage, pour ↑ / ↓ et Entrée. */
export const flatResults = <C extends string>(r: SettingResults<C>) => [
  ...r.current,
  ...r.others.flatMap((g) => g.entries),
]
