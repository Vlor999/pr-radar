import { invoke } from "@tauri-apps/api/core"
import { fetch } from "@tauri-apps/plugin-http"
import { useSyncExternalStore } from "react"

import { pick, strings } from "./i18n"

const S = strings(
  {
    cancelled: "Annulé",
    denied: "Connexion refusée sur GitHub",
    expired: "Code expiré, recommence la connexion",
  },
  {
    cancelled: "Cancelled",
    denied: "Sign-in denied on GitHub",
    expired: "Code expired, start the sign-in again",
  },
)

/**
 * Connexion GitHub sans serveur : le jeton vit dans le trousseau du système (commandes Rust
 * get_token / set_token / delete_token), et en mémoire pour la session.
 */
export type AuthState = { status: "loading" | "signed-out" | "signed-in" }

let token: string | null = null
let state: AuthState = { status: "loading" }
const listeners = new Set<() => void>()

function set(next: AuthState) {
  state = next
  listeners.forEach((l) => l())
}

export const currentToken = () => token

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

// après une déconnexion, ne pas reprendre en silence le compte du CLI `gh`
const SKIP_GH = "pr-radar:skip-gh"
const skipGh = (on: boolean) => {
  try {
    if (on) localStorage.setItem(SKIP_GH, "1")
    else localStorage.removeItem(SKIP_GH)
  } catch {}
}
const ghSkipped = () => {
  try {
    return localStorage.getItem(SKIP_GH) === "1"
  } catch {
    return false
  }
}

/** Comment la session a été ouverte : affiché dans les réglages. */
export type AuthSource = "oauth" | "pat" | "gh"
const SOURCE = "pr-radar:auth-source"
let source: AuthSource | null = null
export const authSource = () => source
const setSource = (s: AuthSource | null) => {
  source = s
  try {
    if (s) localStorage.setItem(SOURCE, s)
    else localStorage.removeItem(SOURCE)
  } catch {}
}

/** Jeton du CLI GitHub s'il est installé et connecté (commande Rust `gh_token`). */
export const ghCliToken = () =>
  invoke<string | null>("gh_token").catch(() => null)

/** Démarrage : jeton du trousseau, sinon compte `gh` déjà connecté sur la machine. */
export async function loadToken() {
  token = await invoke<string | null>("get_token").catch(() => null)
  try {
    source = token
      ? ((localStorage.getItem(SOURCE) as AuthSource | null) ?? "pat")
      : null
  } catch {}
  if (!token && !ghSkipped()) {
    token = await ghCliToken()
    if (token) source = "gh"
  }
  set({ status: token ? "signed-in" : "signed-out" })
}

export async function saveToken(t: string, kind: "oauth" | "pat") {
  await invoke("set_token", { token: t })
  token = t
  setSource(kind)
  skipGh(false)
  set({ status: "signed-in" })
}

/** Connexion avec le compte `gh` : rien n'est copié dans le trousseau, `gh` reste la source. */
export async function signInWithGh(): Promise<boolean> {
  const t = await ghCliToken()
  if (!t) return false
  skipGh(false)
  token = t
  setSource("gh")
  set({ status: "signed-in" })
  return true
}

export async function logout() {
  await invoke("delete_token").catch(() => {})
  token = null
  setSource(null)
  skipGh(true)
  set({ status: "signed-out" })
}

/* ---------- Device flow (comme `gh auth login`) ---------- */

/** OAuth App « PR Radar » (device flow). L'identifiant est public, ce n'est pas un secret. */
export const CLIENT_ID: string =
  import.meta.env.VITE_GITHUB_CLIENT_ID || "Ov23liydg3pRjStpU4wN"
// repo : lire les PR des repos privés et répondre aux discussions ; read:org : lister les repos des orgs
const SCOPES = "repo read:org"

export type DeviceCode = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

async function post<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GitHub : HTTP ${res.status}`)
  return (await res.json()) as T
}

export function startDeviceFlow(): Promise<DeviceCode> {
  return post<DeviceCode>("https://github.com/login/device/code", {
    client_id: CLIENT_ID,
    scope: SCOPES,
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Attend que l'utilisateur valide le code sur github.com ; renvoie le jeton. */
export async function pollDeviceFlow(
  code: DeviceCode,
  signal: AbortSignal,
): Promise<string> {
  let interval = code.interval
  const deadline = Date.now() + code.expires_in * 1000
  while (Date.now() < deadline) {
    await sleep(interval * 1000)
    if (signal.aborted) throw new Error(pick(S).cancelled)
    const res = await post<{
      access_token?: string
      error?: string
      interval?: number
    }>("https://github.com/login/oauth/access_token", {
      client_id: CLIENT_ID,
      device_code: code.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    if (res.access_token) return res.access_token
    if (res.error === "slow_down") interval = res.interval ?? interval + 5
    else if (res.error === "access_denied") throw new Error(pick(S).denied)
    else if (res.error === "expired_token") break
    else if (res.error !== "authorization_pending")
      throw new Error(`GitHub : ${res.error}`)
  }
  throw new Error(pick(S).expired)
}
