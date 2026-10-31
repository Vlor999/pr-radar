import type { Pr, PrNode, Root } from "./types.ts"

export const TRUNKS = ["main", "master"]
export const STALE_DAYS = 5 // par défaut ; réglable dans l'app
const ORDER: Record<string, number> = { CHANGES_REQUESTED: 0, APPROVED: 1 }

/** À traiter : une de mes PR seulement (sur la PR d'un autre, c'est à son auteur d'agir). */
export const needsAttention = (p: Pr) =>
  !p.involved && (p.decision === "CHANGES_REQUESTED" || p.unresolved > 0)
/** Stack natif GitHub, s'il a au moins deux PR. */
export const nativeStack = (p: Pr) =>
  p.stack && p.stack.size > 1 ? p.stack : null
export const isStacked = (p: Pr) => !!nativeStack(p) || !TRUNKS.includes(p.base)
export const idleDays = (p: Pr, now = Date.now()) =>
  Math.floor((now - Date.parse(p.updated)) / 86_400_000)
export const isStale = (p: Pr, now = Date.now(), days = STALE_DAYS) =>
  idleDays(p, now) >= days

/** Prête à merger (une de mes PR seulement : l'autre auteur merge la sienne), bloquée par sa PR parente du
 * stack, ou rien de particulier. */
export type MergeState =
  { kind: "ready" } | { kind: "blocked"; by: number } | null

export function mergeState(p: PrNode): MergeState {
  if (p.parent) return { kind: "blocked", by: p.parent }
  const ciOk = p.ci === null || p.ci === "SUCCESS"
  return !p.involved &&
    p.decision === "APPROVED" &&
    ciOk &&
    !p.conflicting &&
    !p.draft &&
    p.unresolved === 0
    ? { kind: "ready" }
    : null
}

export const descendants = (n: Root | PrNode): PrNode[] =>
  n.children.flatMap((c) => [c, ...descendants(c)])

const byPriority = (a: Pr, b: Pr) =>
  (ORDER[a.decision ?? ""] ?? 2) - (ORDER[b.decision ?? ""] ?? 2) ||
  b.unresolved - a.unresolved ||
  b.number - a.number

/**
 * Rattache chaque PR à celle d'en dessous dans son stack natif GitHub, sinon à la PR dont
 * la branche est sa base (stack déduit), sinon à sa branche de base. Les PR des autres y entrent comme les
 * miennes (base ou enfant d'une de mes PR) ; la tête d'une PR de fork n'est pas une branche du repo.
 */
export function buildTree(prs: Pr[]): Root[] {
  const byHead = new Map(prs.filter((p) => !p.fork).map((p) => [p.head, p]))
  const nativeBelow = (p: Pr) => {
    const s = p.stack
    return s
      ? prs.find(
          (q) =>
            q.stack?.number === s.number && q.stack.position === s.position - 1,
        )
      : undefined
  }
  const below = (p: Pr) => {
    const branch = byHead.get(p.base)
    // une base qui pointe vers la PR au-dessus dans le stack natif ferait un cycle : ignorée
    const up =
      nativeBelow(p) ??
      (branch && nativeBelow(branch) !== p ? branch : undefined)
    return up !== p ? up : undefined
  }
  const kids = new Map<string, Pr[]>() // head d'une PR, ou "base:<branche>"
  for (const p of prs) {
    const key = below(p)?.head ?? "base:" + p.base
    kids.set(key, [...(kids.get(key) ?? []), p])
  }

  const node = (p: Pr, seen: Set<string>): PrNode => ({
    ...p,
    parent: below(p)?.number ?? null,
    children:
      seen.has(p.head) || p.fork // garde-fou anti-cycle ; fork : rien ne part de sa tête
        ? []
        : (kids.get(p.head) ?? [])
            .sort(byPriority)
            .map((k) => node(k, new Set([...seen, p.head]))),
  })

  return [...kids.keys()]
    .filter((k) => k.startsWith("base:"))
    .map((k) => k.slice(5))
    .sort(
      (a, b) =>
        Number(!TRUNKS.includes(a)) - Number(!TRUNKS.includes(b)) ||
        a.localeCompare(b),
    )
    .map((branch) => ({
      branch,
      trunk: TRUNKS.includes(branch),
      children: kids
        .get("base:" + branch)!
        .sort(byPriority)
        .map((p) => node(p, new Set())),
    }))
}

/** Garde les PR qui matchent, plus leurs ancêtres pour garder le contexte du stack. */
export function filterTree(
  roots: Root[],
  match: (p: PrNode) => boolean,
): Root[] {
  const prune = (n: PrNode): PrNode | null => {
    const children = n.children
      .map(prune)
      .filter((c): c is PrNode => c !== null)
    return match(n) || children.length ? { ...n, children } : null
  }
  return roots
    .map((r) => ({
      ...r,
      children: r.children.map(prune).filter((c): c is PrNode => c !== null),
    }))
    .filter((r) => r.children.length)
}

/** Trie chaque niveau de l'arbre (les stacks restent sous leur parent). */
export function sortTree(
  roots: Root[],
  cmp: (a: PrNode, b: PrNode) => number,
): Root[] {
  const sort = (ns: PrNode[]): PrNode[] =>
    [...ns].sort(cmp).map((n) => ({ ...n, children: sort(n.children) }))
  return roots.map((r) => ({ ...r, children: sort(r.children) }))
}

/** Repos passés de N PR à 0 : la recherche GitHub renvoie parfois un vide à tort. Leurs PR sont gardées
 * un cycle ; vides deux fois de suite, ils le sont vraiment. `held` : repos gardés au cycle précédent. */
export function keepVanished(
  prev: Pr[],
  next: Pr[],
  held: Set<string>,
  repos: string[],
) {
  const present = new Set(next.map((p) => p.repo))
  const gone = new Set(
    prev
      .map((p) => p.repo)
      .filter((r) => !present.has(r) && !held.has(r) && repos.includes(r)),
  )
  return { prs: [...next, ...prev.filter((p) => gone.has(p.repo))], held: gone }
}
