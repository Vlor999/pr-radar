/** Vue Fil : filtres et recherche (suggestions, jetons, surlignage). Logique pure. */
// extensions : chargé aussi par node --test
import {
  TIMELINE_SUGGEST_PRS,
  TIMELINE_SUGGEST_RECENT,
  TIMELINE_SUGGEST_REPOS,
} from "./constants.ts"
import type { TimelineRow, TimelineStatus } from "./timeline.ts"

export type TimelineOwner = "all" | "mine" | "others"

export type TimelineFilters = {
  q: string
  owner: TimelineOwner
  status: "all" | TimelineStatus
  /** jetons : repos choisis (clés) et PR choisies (`repo#numéro`) */
  repos: string[]
  prs: string[]
}

export const NO_FILTERS: TimelineFilters = {
  q: "",
  owner: "all",
  status: "all",
  repos: [],
  prs: [],
}

export const filtersActive = (f: TimelineFilters) =>
  !!f.q.trim() ||
  f.owner !== "all" ||
  f.status !== "all" ||
  f.repos.length > 0 ||
  f.prs.length > 0

export const shortRepo = (repo: string) => repo.split("/").pop() ?? repo

const MARKS = /[̀-ͯ]/g

/**
 * Texte normalisé pour la recherche (sans accents ni `#`, minuscules, espaces simples) et, pour chaque
 * caractère gardé, sa position dans le texte d'origine (surlignage).
 */
function normalizeMap(text: string): { s: string; at: number[] } {
  let s = ""
  const at: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "#") continue
    if (/\s/.test(ch)) {
      if (s && !s.endsWith(" ")) {
        s += " "
        at.push(i)
      }
      continue
    }
    for (const c of ch.normalize("NFD").replace(MARKS, "").toLowerCase()) {
      s += c
      at.push(i)
    }
  }
  if (s.endsWith(" ")) {
    s = s.slice(0, -1)
    at.pop()
  }
  return { s, at }
}

export const normalize = (text: string) => normalizeMap(text).s

/** Partie de `text` qui correspond à `q` (normalisée), pour un `<mark>` ; absente : `null`. */
export function highlight(
  text: string,
  q: string,
): [before: string, match: string, after: string] | null {
  const nq = normalize(q)
  if (!nq) return null
  const { s, at } = normalizeMap(text)
  const i = s.indexOf(nq)
  if (i < 0) return null
  const from = at[i]
  const to = at[i + nq.length - 1] + 1
  return [text.slice(0, from), text.slice(from, to), text.slice(to)]
}

const matches = (r: TimelineRow, nq: string) =>
  normalize(`${r.repo} ${r.number} ${r.title}`).includes(nq)

/** Lignes affichées : non masquées, puis auteur, état, jetons (PR choisies ∪ PR des repos choisis), texte. */
export function applyFilters(
  rows: TimelineRow[],
  f: TimelineFilters,
  hidden: string[],
): TimelineRow[] {
  const nq = normalize(f.q)
  const tokens = f.repos.length > 0 || f.prs.length > 0
  return rows.filter(
    (r) =>
      !hidden.includes(r.key) &&
      (f.owner === "all" || r.mine === (f.owner === "mine")) &&
      (f.status === "all" || r.status === f.status) &&
      (!tokens || f.repos.includes(r.repo) || f.prs.includes(r.key)) &&
      (!nq || matches(r, nq)),
  )
}

export type Suggestion =
  | { type: "repo"; repo: string; count: number; selected: boolean }
  | { type: "pr"; row: TimelineRow; selected: boolean }

/**
 * Propositions de la recherche : repos (par nom), puis PR (repo court, numéro, titre). Champ vide : tous les
 * repos et les PR les plus récentes. Une proposition déjà choisie est marquée (la rechoisir la retire).
 */
export function suggestions(
  pool: TimelineRow[],
  q: string,
  f: Pick<TimelineFilters, "repos" | "prs">,
): Suggestion[] {
  const nq = normalize(q)
  const counts = new Map<string, number>()
  for (const r of pool) counts.set(r.repo, (counts.get(r.repo) ?? 0) + 1)
  const repos = [...counts]
    .filter(([repo]) => !nq || normalize(repo).includes(nq))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, TIMELINE_SUGGEST_REPOS)
    .map(([repo, count]): Suggestion => ({
      type: "repo",
      repo,
      count,
      selected: f.repos.includes(repo),
    }))
  const prs = (
    nq
      ? pool
          .filter((r) =>
            normalize(`${shortRepo(r.repo)} ${r.number} ${r.title}`).includes(
              nq,
            ),
          )
          .slice(0, TIMELINE_SUGGEST_PRS)
      : pool.slice(0, TIMELINE_SUGGEST_RECENT)
  ).map((row): Suggestion => ({
    type: "pr",
    row,
    selected: f.prs.includes(row.key),
  }))
  return [...repos, ...prs]
}

const toggle = (xs: string[], v: string) =>
  xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]

/** Choix d'une proposition : ajoute son jeton, ou le retire s'il y était ; le texte tapé est vidé. */
export const pickSuggestion = (
  f: TimelineFilters,
  s: Suggestion,
): TimelineFilters =>
  s.type === "repo"
    ? { ...f, q: "", repos: toggle(f.repos, s.repo) }
    : { ...f, q: "", prs: toggle(f.prs, s.row.key) }

/** Retour arrière dans un champ vide : retire le dernier jeton (PR d'abord, comme leur ordre d'affichage). */
export const dropLastToken = (f: TimelineFilters): TimelineFilters =>
  f.prs.length
    ? { ...f, prs: f.prs.slice(0, -1) }
    : { ...f, repos: f.repos.slice(0, -1) }
