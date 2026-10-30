import { invoke as tauriInvoke } from "@tauri-apps/api/core"
import {
  listen as tauriListen,
  type EventCallback,
} from "@tauri-apps/api/event"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener"
import { useSyncExternalStore } from "react"

/**
 * Version web locale : la même interface, servie par l'app sur 127.0.0.1 et ouverte dans un onglet.
 * Sans IPC Tauri, les commandes, les requêtes HTTP et les réglages partagés passent par ce serveur
 * (src-tauri/src/web.rs). Ce module choisit l'un ou l'autre ; le reste de l'interface ne change pas.
 */
export const isWeb =
  typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)

/* ---------- Session du navigateur ---------- */

let locked = false
const listeners = new Set<() => void>()

/** Cookie absent ou périmé (secret régénéré) : l'interface affiche comment rouvrir le lien. */
export const useLocked = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => locked,
  )

async function api(path: string, body?: unknown): Promise<Response> {
  const res = await window.fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  )
  // /auth refusé (ticket expiré) : une session déjà ouverte reste valable
  if (res.status === 401 && path !== "/auth" && !locked) {
    locked = true
    listeners.forEach((l) => l())
  }
  return res
}

/** Erreur HTTP du serveur de l'app (503 : copie partagée pas encore reçue de l'app). */
export class HttpError extends Error {
  status: number
  constructor(status: number) {
    super(`web version: HTTP ${status}`)
    this.status = status
  }
}

/** Ticket du lien ouvert par l'app (`#k=…`, une minute, un seul usage), sinon null. */
export const ticketFromHash = (hash: string) =>
  new URLSearchParams(hash.replace(/^#/, "")).get("k")

/** Lien ouvert depuis l'app : le ticket est échangé contre un cookie de session, puis retiré de l'adresse. */
export async function connectWeb() {
  const ticket = ticketFromHash(location.hash)
  if (!ticket) return
  history.replaceState(null, "", location.pathname + location.search)
  await api("/auth", { ticket })
}

/* ---------- Commandes ---------- */

async function webInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const res = await api(`/invoke/${encodeURIComponent(cmd)}`, args ?? {})
  const body = (await res.json().catch(() => null)) as unknown
  // comme l'IPC de Tauri : rejet avec le message d'erreur
  if (!res.ok) throw typeof body === "string" ? body : `HTTP ${res.status}`
  return body as T
}

export const invoke: <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T> = isWeb ? webInvoke : tauriInvoke

/** Événements de l'app : aucun dans le navigateur (le retour de connexion Slack reste dans l'app). */
export const listen = <T>(event: string, handler: EventCallback<T>) =>
  isWeb ? Promise.resolve(() => {}) : tauriListen<T>(event, handler)

export const openUrl = (url: string) =>
  isWeb
    ? Promise.resolve(void window.open(url, "_blank", "noopener"))
    : tauriOpenUrl(url)

/* ---------- HTTP ---------- */

export type ProxyRequest = {
  url: string
  method: string
  headers: [string, string][]
  body?: string
}

export type ProxyResponse = {
  status: number
  headers: [string, string][]
  body: string
}

/** Requête envoyée au serveur de l'app : les appels de l'interface n'ont que des corps texte. */
export function toProxyRequest(url: string, init?: RequestInit): ProxyRequest {
  if (init?.body != null && typeof init.body !== "string")
    throw new Error("web version: only text bodies are supported")
  return {
    url,
    method: init?.method ?? "GET",
    headers: [...new Headers(init?.headers).entries()],
    ...(init?.body != null && { body: init.body }),
  }
}

/** Réponse reconstruite ; 204 et 304 n'ont pas de corps. */
export const fromProxyResponse = (r: ProxyResponse) =>
  new Response(r.status === 204 || r.status === 304 ? null : r.body, {
    status: r.status,
    headers: r.headers,
  })

async function proxyFetch(url: string, init?: RequestInit) {
  const res = await api("/fetch", toProxyRequest(url, init))
  if (!res.ok) throw new Error(`web version: HTTP ${res.status}`)
  return fromProxyResponse((await res.json()) as ProxyResponse)
}

export const fetch: (url: string, init?: RequestInit) => Promise<Response> =
  isWeb ? proxyFetch : tauriFetch

/* ---------- Réglages partagés (copie gardée par l'app) ---------- */

export const kvPull = async (): Promise<Record<string, string>> => {
  if (!isWeb) return invoke<Record<string, string>>("kv_pull")
  const res = await api("/kv")
  if (!res.ok) throw new HttpError(res.status)
  return (await res.json()) as Record<string, string>
}

export const kvPush = async (entries: Record<string, string | null>) => {
  if (!isWeb) return invoke<void>("kv_push", { entries })
  const res = await api("/kv", entries)
  if (!res.ok) throw new HttpError(res.status)
}

/** Fenêtre de l'app seulement : son stockage devient la copie partagée. */
export const kvSeed = (entries: Record<string, string>) =>
  invoke<void>("kv_seed", { entries })
