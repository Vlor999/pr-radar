import { isWeb, kvPull, kvPush, kvSeed } from "./platform.ts"

/**
 * localStorage est propre à chaque origine : la fenêtre de l'app et l'onglet de la version web
 * partagent leurs clés par une copie gardée en mémoire par l'app (dernière écriture gagnante par clé).
 */
const PREFIX = "pr-radar:"
/** marques « vu » (src/hooks/use-seen.ts), clé d'avant le préfixe */
const SEEN = "pr-seen"
/** propres à chaque fenêtre : thème, dernière notification et historique MCP (tenus par l'app seule) */
const LOCAL_ONLY = [
  "pr-radar:theme",
  "pr-radar:last-notification",
  "pr-radar:mcp-history",
]

export const isSynced = (key: string) =>
  (key.startsWith(PREFIX) || key === SEEN) && !LOCAL_ONLY.includes(key)

type Store = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>

const syncedKeys = (s: Store) =>
  Array.from({ length: s.length }, (_, i) => s.key(i)).filter(
    (k): k is string => k !== null && isSynced(k),
  )

/** Clés partagées d'un stockage. */
export const snapshotOf = (s: Store): Record<string, string> =>
  Object.fromEntries(syncedKeys(s).map((k) => [k, s.getItem(k) ?? ""]))

/**
 * Applique la copie partagée : ses valeurs, et les clés partagées qu'elle n'a plus sont effacées.
 * `skip` : clés écrites ici et pas encore envoyées, gardées. Renvoie les clés modifiées.
 */
export function applySnapshot(
  s: Store,
  snap: Record<string, string>,
  skip: ReadonlySet<string> = new Set(),
) {
  const changed: string[] = []
  for (const k of syncedKeys(s))
    if (!(k in snap) && !skip.has(k)) {
      s.removeItem(k)
      changed.push(k)
    }
  for (const [k, v] of Object.entries(snap))
    if (isSynced(k) && !skip.has(k) && s.getItem(k) !== v) {
      s.setItem(k, v)
      changed.push(k)
    }
  return changed
}

/** Recalcule une écriture sur la valeur partagée relue juste avant l'envoi (objet entier : un champ changé ailleurs est gardé). */
export type Rebase = (remote: string | null) => string | null

export type Transport = {
  pull: () => Promise<Record<string, string>>
  push: (entries: Record<string, string | null>) => Promise<void>
  seed: (entries: Record<string, string>) => Promise<void>
}

type Pending = { value: string | null; rebase?: Rebase }

/**
 * Écritures et relectures d'un stockage, dans une seule file : une relecture ne passe pas devant un envoi.
 * Une écriture reste en attente tant que l'app ne l'a pas reçue (renvoyée au prochain envoi ou à la
 * prochaine relecture) ; une relecture ne l'écrase pas.
 */
export function createSync(storage: () => Store, transport: Transport) {
  const pending = new Map<string, Pending>()
  const listeners = new Set<(keys: string[]) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const queue = <T>(f: () => Promise<T>): Promise<T> => {
    const p = chain.then(f)
    chain = p.catch(() => {})
    return p
  }
  const notify = (keys: string[]) => {
    if (keys.length) listeners.forEach((l) => l(keys))
  }
  const write = (key: string, value: string | null) => {
    try {
      if (value === null) storage().removeItem(key)
      else storage().setItem(key, value)
    } catch {}
  }

  /** Envoie les écritures en attente ; en échec, elles restent pour le prochain essai. */
  async function flush() {
    if (!pending.size) return
    const batch = [...pending]
    const remote = batch.some(([, e]) => e.rebase) ? await transport.pull() : {}
    const out = Object.fromEntries(
      batch.map(([k, e]) => [
        k,
        e.rebase ? e.rebase(remote[k] ?? null) : e.value,
      ]),
    )
    await transport.push(out)
    const rebased: string[] = []
    for (const [k, e] of batch) {
      if (pending.get(k) !== e) continue // réécrite entre-temps : envoyée au prochain tour
      pending.delete(k)
      if (e.rebase && out[k] !== e.value) {
        write(k, out[k])
        rebased.push(k)
      }
    }
    notify(rebased)
  }

  return {
    /** Écrit (ou efface : `null`) une clé ; une clé partagée part aussi vers l'app. */
    save(key: string, value: string | null, rebase?: Rebase) {
      write(key, value)
      if (!isSynced(key)) return
      const prev = pending.get(key)?.rebase
      pending.set(key, {
        value,
        rebase: rebase && prev ? (r: string | null) => rebase(prev(r)) : rebase,
      })
      queue(flush).catch(() => {})
    },

    /** Relit la copie partagée (écritures en attente envoyées d'abord) ; rien n'est appliqué après une erreur. */
    pull: () =>
      queue(async () => {
        await flush().catch(() => {})
        const snap = await transport.pull()
        notify(applySnapshot(storage(), snap, new Set(pending.keys())))
      }),

    /** Fenêtre de l'app, au lancement : son stockage alimente la copie partagée. */
    seed: () => queue(() => transport.seed(snapshotOf(storage()))),

    onPulled(l: (keys: string[]) => void) {
      listeners.add(l)
      return () => listeners.delete(l)
    },

    /** Fin de la file (tests). */
    idle: () => chain,
  }
}

const sync = createSync(() => localStorage, {
  pull: kvPull,
  push: kvPush,
  seed: kvSeed,
})

/** Écrit (ou efface : `null`) une clé de localStorage ; une clé partagée part aussi vers l'app. */
export const saveItem = sync.save
/** Clés modifiées par une relecture : les modules qui les gardent en mémoire les relisent. */
export const onPulled = sync.onPulled
/** Relit la copie partagée. */
export const pull = sync.pull

/** Lancement de la fenêtre de l'app : son stockage alimente la copie partagée, puis elle la relit. */
export async function seed() {
  if (isWeb) return
  await sync.seed()
  await sync.pull()
}
