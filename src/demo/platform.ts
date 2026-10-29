// Démo navigateur : même API que src/lib/platform.ts. `?web` dans l'adresse : aperçu de la version web.
import { fetch, invoke, openUrl } from "./tauri"

export { fetch, invoke, openUrl }

export const isWeb = new URLSearchParams(location.search).has("web")
export const useLocked = () => false
export const secretFromHash = (_hash: string) => null
export const connectWeb = async () => {}
export const listen = async () => () => {}

// réglages partagés : un seul localStorage dans la démo, rien à copier
export const kvPull = async (): Promise<Record<string, string>> => {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k) out[k] = localStorage.getItem(k) ?? ""
  }
  return out
}
export const kvPush = async (_entries: Record<string, string | null>) => {}
export const kvSeed = async (_entries: Record<string, string>) => {}
