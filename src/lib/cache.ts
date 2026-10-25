/** Entrée de cache en mémoire : logique pure, sans Tauri. */
export type Entry<T> = { until: number; value: Promise<T> }

/** Retire les entrées expirées : les clés changent (jour, repos suivis) et resteraient jusqu'à clearCache. */
export const sweep = (m: Map<string, Entry<unknown>>, now: number) => {
  for (const [k, e] of m) if (now >= e.until) m.delete(k)
}
