import { invoke } from "@tauri-apps/api/core"
import { fetch } from "@tauri-apps/plugin-http"
import { useSyncExternalStore } from "react"

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
    () => state
  )
}

export async function loadToken() {
  try {
    token = await invoke<string | null>("get_token")
  } catch {
    token = null
  }
  set({ status: token ? "signed-in" : "signed-out" })
}

export async function saveToken(t: string) {
  await invoke("set_token", { token: t })
  token = t
  set({ status: "signed-in" })
}

export async function logout() {
  await invoke("delete_token").catch(() => {})
  token = null
  set({ status: "signed-out" })
}

/* ---------- Device flow (comme `gh auth login`) ---------- */

/** OAuth App publique : l'identifiant n'est pas un secret. Vide = seul le jeton personnel est proposé. */
export const CLIENT_ID: string = import.meta.env.VITE_GITHUB_CLIENT_ID ?? ""
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
  return post<DeviceCode>("https://github.com/login/device/code", { client_id: CLIENT_ID, scope: SCOPES })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Attend que l'utilisateur valide le code sur github.com ; renvoie le jeton. */
export async function pollDeviceFlow(code: DeviceCode, signal: AbortSignal): Promise<string> {
  let interval = code.interval
  const deadline = Date.now() + code.expires_in * 1000
  while (Date.now() < deadline) {
    await sleep(interval * 1000)
    if (signal.aborted) throw new Error("Annulé")
    const res = await post<{ access_token?: string; error?: string; interval?: number }>(
      "https://github.com/login/oauth/access_token",
      {
        client_id: CLIENT_ID,
        device_code: code.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }
    )
    if (res.access_token) return res.access_token
    if (res.error === "slow_down") interval = res.interval ?? interval + 5
    else if (res.error === "access_denied") throw new Error("Connexion refusée sur GitHub")
    else if (res.error === "expired_token") break
    else if (res.error !== "authorization_pending") throw new Error(`GitHub : ${res.error}`)
  }
  throw new Error("Code expiré, recommence la connexion")
}
