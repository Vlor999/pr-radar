import { isWeb, kvPull, kvPush, kvSeed } from "./platform.ts"

/**
 * localStorage est propre à chaque origine : la fenêtre de l'app et l'onglet de la version web
 * partagent leurs clés par une copie gardée en mémoire par l'app (dernière écriture gagnante).
 */
const PREFIX = "pr-radar:"
/** marques « vu » (src/hooks/use-seen.ts), clé d'avant le préfixe */
const SEEN = "pr-seen"
/** propres à chaque fenêtre : thème, dernière notification (envoyée par l'app seule) */
const LOCAL_ONLY = ["pr-radar:theme", "pr-radar:last-notification"]

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

/** Applique la copie partagée : ses valeurs, et les clés partagées qu'elle n'a plus sont effacées. Renvoie les clés modifiées. */
export function applySnapshot(s: Store, snap: Record<string, string>) {
  const changed: string[] = []
  for (const k of syncedKeys(s))
    if (!(k in snap)) {
      s.removeItem(k)
      changed.push(k)
    }
  for (const [k, v] of Object.entries(snap))
    if (isSynced(k) && s.getItem(k) !== v) {
      s.setItem(k, v)
      changed.push(k)
    }
  return changed
}

/** Écritures et relectures dans l'ordre : une relecture ne passe pas devant une écriture en cours d'envoi. */
let chain: Promise<unknown> = Promise.resolve()
function queue<T>(f: () => Promise<T>): Promise<T> {
  const p = chain.then(f)
  chain = p.catch(() => {})
  return p
}

/** Écrit (ou efface : `null`) une clé de localStorage ; une clé partagée part aussi vers l'app. */
export function saveItem(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
  if (isSynced(key)) queue(() => kvPush({ [key]: value })).catch(() => {})
}

const listeners = new Set<(keys: string[]) => void>()

/** Clés modifiées par une relecture : les modules qui les gardent en mémoire les relisent. */
export function onPulled(l: (keys: string[]) => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Relit la copie partagée. */
export async function pull() {
  const snap = await queue(kvPull)
  const changed = applySnapshot(localStorage, snap)
  if (changed.length) listeners.forEach((l) => l(changed))
}

/** Lancement de la fenêtre de l'app : son stockage devient la copie partagée. */
export function seed() {
  if (isWeb) return
  try {
    const snap = snapshotOf(localStorage)
    queue(() => kvSeed(snap)).catch(() => {})
  } catch {}
}
