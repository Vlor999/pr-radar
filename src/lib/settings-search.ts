/** poids d'un mot trouvé dans la description ou les mots-clés, par rapport au libellé */
const REST_WEIGHT = 0.4
/** qualité d'un mot trouvé : mot entier > début de mot > ailleurs dans le texte > faute de frappe */
const QUALITY = { word: 1, prefix: 0.9, inside: 0.8, typo1: 0.6, typo2: 0.45 }
/** mots de la requête plus courts : pas de tolérance aux fautes (trop de faux positifs) */
const FUZZY_MIN_LENGTH = 4
/** à partir de cette longueur, deux fautes tolérées au lieu d'une */
const TWO_TYPOS_LENGTH = 8

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

/** Distance de Damerau-Levenshtein (transpositions adjacentes comprises, variante OSA). */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)),
  )
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  return d[a.length][b.length]
}

/** Fautes tolérées pour un mot de la requête : 0 sous 4 lettres, 1 jusqu'à 7, 2 au-delà. */
const maxTypos = (q: string) =>
  q.length < FUZZY_MIN_LENGTH ? 0 : q.length < TWO_TYPOS_LENGTH ? 1 : 2

/** Plus petite distance entre `q` et un mot du texte ou un début de ce mot (« notifcation » → « notifications »). */
const typos = (q: string, words: string[], max: number) => {
  let best = Infinity
  for (const w of words)
    for (let n = q.length - max; n <= q.length + max; n++) {
      if (n < 1 || n > w.length) continue
      best = Math.min(best, editDistance(q, w.slice(0, n)))
    }
  return best
}

type Field = { text: string; words: string[] }

const field = (s: string): Field => {
  const text = fold(s)
  return { text, words: text.split(/[^\p{L}\p{N}]+/u).filter(Boolean) }
}

/** Qualité du meilleur appariement de `q` dans le champ, 0 si absent ; `typo` : seulement avec une faute. */
const quality = (q: string, f: Field): { q: number; typo: boolean } => {
  if (f.words.includes(q)) return { q: QUALITY.word, typo: false }
  if (f.words.some((w) => w.startsWith(q)))
    return { q: QUALITY.prefix, typo: false }
  if (f.text.includes(q)) return { q: QUALITY.inside, typo: false }
  const max = maxTypos(q)
  const d = max ? typos(q, f.words, max) : Infinity
  if (d > max) return { q: 0, typo: false }
  return { q: d === 1 ? QUALITY.typo1 : QUALITY.typo2, typo: true }
}

/**
 * Score d'un réglage pour les mots de la requête, `null` si un mot manque.
 * `tier` : 2 si un mot est dans le libellé, 1 si un mot est trouvé sans faute ailleurs,
 * 0 si tout passe par des fautes dans la description : jamais devant un libellé trouvé.
 */
const score = (entry: SettingEntry, words: string[]) => {
  const label = field(entry.label)
  const rest = field(`${entry.description ?? ""} ${entry.keywords ?? ""}`)
  let sum = 0
  let labelHit = false
  let exactRest = false
  for (const w of words) {
    const l = quality(w, label)
    const r = quality(w, rest)
    if (!l.q && !r.q) return null
    if (l.q >= r.q * REST_WEIGHT) {
      labelHit = true
      sum += l.q
    } else {
      if (!r.typo) exactRest = true
      sum += r.q * REST_WEIGHT
    }
  }
  return { tier: labelHit ? 2 : exactRest ? 1 : 0, value: sum / words.length }
}

/**
 * Réglages où chaque mot de la requête est trouvé (fautes de frappe tolérées à partir de 4 lettres) :
 * catégorie courante d'abord, puis les autres ; dans chaque groupe, les meilleurs scores d'abord.
 */
export function searchSettings<C extends string>(
  index: SettingEntry<C>[],
  query: string,
  current: C,
): SettingResults<C> {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return { current: [], others: [], count: 0 }
  const hits = index
    .map((entry, i) => ({ entry, i, s: score(entry, words) }))
    .filter((h) => h.s !== null)
    .sort(
      (a, b) => b.s!.tier - a.s!.tier || b.s!.value - a.s!.value || a.i - b.i,
    )
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
