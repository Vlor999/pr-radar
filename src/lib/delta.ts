/** Actualisation par différence (sondage léger, puis lecture complète des seules PR changées) : logique pure, sans Tauri. */
import { FULL_REFRESH_MAX_AGE_MS } from "./constants.ts"

/** Empreinte d'une PR lue par le sondage, et la PR construite à sa dernière lecture complète. */
export type Known<P> = { fp: string; pr: P }
/** Dernière lecture d'un lot de repos d'un compte : PR par id, et date (ms) de la dernière relecture complète. */
export type Snapshot<P> = { fullAt: number; prs: Map<string, Known<P>> }
export type Probed = { id: string; fp: string }

/** Empreinte d'un nœud du sondage : tous ses champs, dans l'ordre de la requête (stable d'un appel à l'autre). */
export const fingerprint = (node: { id: string }) => JSON.stringify(node)

/**
 * Relecture complète du lot : demandée (actualisation manuelle, premier chargement, action), lot inconnu
 * (compte ou repos suivis changés : la clé du lot change) ou dernière relecture complète trop ancienne.
 */
export const isFullRead = (
  prev: Snapshot<unknown> | undefined,
  now: number,
  forced: boolean,
) => forced || !prev || now - prev.fullAt > FULL_REFRESH_MAX_AGE_MS

/**
 * Date de relecture complète gardée dans l'instantané : maintenant après une relecture complète, sinon la
 * précédente. Recherche des mentions en échec : -Infinity, le prochain tick relit tout (sinon le motif « Impliqué »
 * mis à la place de « Mentionné » resterait jusqu'à la relecture complète suivante).
 */
export const nextFullAt = (
  whole: boolean,
  now: number,
  prevFullAt: number,
  mentionsFailed: boolean,
) => (mentionsFailed ? -Infinity : whole ? now : prevFullAt)

/** Ids à relire en entier (nouvelles PR, empreinte changée) et PR reprises telles quelles ; `prev` null : tout relire. */
export function splitProbe<P>(
  probe: Probed[],
  prev: Map<string, Known<P>> | null,
): { changed: string[]; kept: Map<string, P> } {
  const changed: string[] = []
  const kept = new Map<string, P>()
  for (const { id, fp } of probe) {
    const known = prev?.get(id)
    if (known && known.fp === fp) kept.set(id, known.pr)
    else changed.push(id)
  }
  return { changed, kept }
}

/**
 * PR du lot dans l'ordre du sondage, et l'instantané suivant. Une PR absente du sondage est partie (fermée,
 * mergée, recherche vide à tort : `keepVanished` du store décide) ; ni reprise ni relue (supprimée entre
 * le sondage et la lecture) : écartée.
 */
export function mergeProbe<P>(
  probe: Probed[],
  kept: Map<string, P>,
  fetched: Map<string, P>,
  fullAt: number,
): { prs: P[]; snapshot: Snapshot<P> } {
  const prs: P[] = []
  const known = new Map<string, Known<P>>()
  for (const { id, fp } of probe) {
    const pr = fetched.get(id) ?? kept.get(id)
    if (!pr) continue
    prs.push(pr)
    known.set(id, { fp, pr })
  }
  return { prs, snapshot: { fullAt, prs: known } }
}
