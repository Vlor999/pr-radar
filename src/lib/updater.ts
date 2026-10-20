import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { useSyncExternalStore } from "react"

import { pick, strings } from "./i18n"

/**
 * Mise à jour intégrée : l'app lit latest.json sur la dernière release GitHub, vérifie la signature
 * (clé publique dans tauri.conf.json), télécharge, installe, puis redémarre.
 */
export const S = strings(
  { unknownError: "erreur inconnue" },
  { unknownError: "unknown error" },
)

type UpdateState =
  | { status: "idle" | "checking" | "up-to-date" }
  | { status: "available"; version: string; notes?: string }
  | { status: "downloading"; version: string; progress: number | null }
  | { status: "ready"; version: string }
  | { status: "error"; message: string }

let state: UpdateState = { status: "idle" }
let pending: Update | null = null
const listeners = new Set<() => void>()

function set(next: UpdateState) {
  state = next
  listeners.forEach((l) => l())
}

export function useUpdate(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

const message = (e: unknown) =>
  e instanceof Error ? e.message : String(e ?? pick(S).unknownError)

/** Cherche une version plus récente. `quiet` : pas d'erreur affichée (vérification automatique). */
export async function checkForUpdate({ quiet = false } = {}) {
  if (state.status === "downloading" || state.status === "ready") return
  set({ status: "checking" })
  try {
    pending = await check()
    set(
      pending
        ? { status: "available", version: pending.version, notes: pending.body }
        : { status: "up-to-date" },
    )
  } catch (e) {
    set(quiet ? { status: "idle" } : { status: "error", message: message(e) })
  }
}

/** Télécharge et installe la version trouvée, avec progression, puis redémarre l'app. */
export async function installUpdate() {
  if (!pending) return
  const version = pending.version
  let total = 0
  let received = 0
  set({ status: "downloading", version, progress: null })
  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0
      if (event.event === "Progress") {
        received += event.data.chunkLength
        set({
          status: "downloading",
          version,
          progress: total ? received / total : null,
        })
      }
    })
    set({ status: "ready", version })
    await relaunch()
  } catch (e) {
    set({ status: "error", message: message(e) })
  }
}
