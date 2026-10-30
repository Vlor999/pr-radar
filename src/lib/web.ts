import { useSyncExternalStore } from "react"

import { strings } from "./i18n.ts"
import { invoke } from "./platform.ts"
import type { WebStatus } from "./types.ts"

/** Erreur de démarrage du serveur : textes partagés par les réglages et le bouton de l'en-tête. */
export const WEB_ERRORS = strings(
  {
    portBusy: (port: number) =>
      `Le port ${port} est déjà utilisé par une autre application : choisis-en un autre.`,
    startError: (e: string) => `Impossible de démarrer le serveur : ${e}`,
  },
  {
    portBusy: (port: number) =>
      `Port ${port} is already used by another application: pick another one.`,
    startError: (e: string) => `Could not start the server: ${e}`,
  },
)

/** Message de l'erreur de démarrage du statut, null sans erreur. */
export const startErrorText = (t: typeof WEB_ERRORS.fr, s: WebStatus) =>
  s.error === "port-busy"
    ? t.portBusy(s.port)
    : s.error
      ? t.startError(s.error)
      : null

type Call = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

/* ---------- État partagé : en-tête (pastille, bulle) et page de la version web ---------- */

let current: WebStatus | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const save = (s: WebStatus) => {
  current = s
  listeners.forEach((l) => l())
  return s
}

/** Dernier statut connu, null avant la première lecture. */
export const useWebStatus = () => useSyncExternalStore(subscribe, () => current)

export const loadWebStatus = async (call: Call = invoke) =>
  save(await call<WebStatus>("web_status"))

/** Active / désactive le serveur, change son port ; une erreur de démarrage est dans le statut. */
export const configureWeb = async (
  enabled: boolean,
  port: number,
  call: Call = invoke,
) => save(await call<WebStatus>("web_configure", { enabled, port }))

/** Serveur arrêté (désactivé, ou port pris au lancement) : activé avec le port enregistré. */
async function startWeb(call: Call): Promise<WebStatus> {
  const status = await loadWebStatus(call)
  return status.running ? status : configureWeb(true, status.port, call)
}

/** Bulle de l'en-tête : arrête le serveur s'il tourne, sinon le démarre (sans ouvrir le navigateur). */
export async function toggleWeb(call: Call = invoke): Promise<WebStatus> {
  const status = await loadWebStatus(call)
  return configureWeb(!status.running, status.port, call)
}

/**
 * Ouvre la version web dans le navigateur, serveur démarré d'abord si besoin. Renvoie le statut final :
 * `running` faux = rien d'ouvert, la cause est dans `error`.
 */
export async function openWeb(call: Call = invoke): Promise<WebStatus> {
  const status = await startWeb(call)
  if (status.running) await call("web_open")
  return status
}
