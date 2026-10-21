import { invoke } from "@tauri-apps/api/core"
import { fetch } from "@tauri-apps/plugin-http"
import { useSyncExternalStore } from "react"

import {
  DEFAULT_ID,
  GITHUB,
  newAccountId,
  savedAccounts,
  type Account,
  type AuthSource,
} from "./accounts"
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
 * Connexion GitHub sans serveur, un ou plusieurs comptes (github.com, GitHub Enterprise) : chaque
 * jeton vit dans le trousseau du système (commandes Rust get_token / set_token / delete_token, une
 * entrée par compte), et en mémoire pour la session. La liste des comptes est dans localStorage.
 */
export type AuthState = {
  status: "loading" | "signed-out" | "signed-in"
  accounts: Account[]
}

const ACCOUNTS = "pr-radar:accounts"
let accounts: Account[] = []
const tokens = new Map<string, string>()
let state: AuthState = { status: "loading", accounts }
const listeners = new Set<() => void>()

function set(status: AuthState["status"]) {
  state = { status, accounts }
  listeners.forEach((l) => l())
}

const persist = () => {
  try {
    localStorage.setItem(ACCOUNTS, JSON.stringify(accounts))
  } catch {}
}

/** Jeton d'un compte : n'est envoyé qu'à l'hôte de ce compte (src/lib/github.ts). */
export const tokenOf = (id: string) => tokens.get(id) ?? null
export const allAccounts = () => accounts
export const findAccount = (id: string) => accounts.find((a) => a.id === id)

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

/** Source du compte unique d'avant le multi-compte : lue une fois, pour la migration. */
const LEGACY_SOURCE = "pr-radar:auth-source"

/** Jeton du CLI GitHub s'il est installé et connecté (commande Rust `gh_token`). */
export const ghCliToken = () =>
  invoke<string | null>("gh_token").catch(() => null)

/** Autorise le plugin HTTP à joindre l'API d'un hôte GitHub Enterprise (commande Rust `allow_host`). */
export const allowHost = (host: string) =>
  host === GITHUB ? Promise.resolve() : invoke<void>("allow_host", { host })

const readToken = (a: Account) =>
  a.source === "gh"
    ? ghCliToken()
    : invoke<string | null>("get_token", { account: a.id }).catch(() => null)

/** Démarrage : jetons du trousseau, sinon compte `gh` déjà connecté sur la machine. */
export async function loadToken() {
  let saved: Account[] | null = null
  let legacy: AuthSource | null = null
  try {
    saved = JSON.parse(localStorage.getItem(ACCOUNTS) ?? "null") as
      Account[] | null
    legacy = localStorage.getItem(LEGACY_SOURCE) as AuthSource | null
  } catch {}
  const live: Account[] = []
  for (const a of savedAccounts(saved, legacy)) {
    const t = await readToken(a)
    if (!t) continue
    await allowHost(a.host).catch(() => {}) // refusé : les appels à cet hôte échoueront, avec un message
    tokens.set(a.id, t)
    live.push(a)
  }
  if (!live.length && !ghSkipped()) {
    const t = await ghCliToken()
    if (t) {
      tokens.set(DEFAULT_ID, t)
      live.push({ id: DEFAULT_ID, host: GITHUB, source: "gh" })
    }
  }
  accounts = live
  if (!saved) persist() // migration : le jeton reste sous `github`, rien à recopier
  set(accounts.length ? "signed-in" : "signed-out")
}

/**
 * Ajoute un compte (ou remplace le jeton d'un compte déjà connecté avec ce login sur cet hôte).
 * Le jeton va au trousseau, sauf celui du CLI `gh` qui reste la source. Renvoie l'id du compte.
 */
export async function addAccount(
  token: string,
  source: AuthSource,
  host: string,
  login: string,
): Promise<string> {
  const id =
    accounts.find((a) => a.host === host && a.login === login)?.id ??
    newAccountId(accounts, host, login)
  if (source === "gh")
    await invoke("delete_token", { account: id }).catch(() => {})
  else await invoke("set_token", { account: id, token })
  tokens.set(id, token)
  const account: Account = { id, host, source, login }
  accounts = accounts.some((a) => a.id === id)
    ? accounts.map((a) => (a.id === id ? account : a))
    : [...accounts, account]
  persist()
  skipGh(false)
  set("signed-in")
  return id
}

/** Login découvert après coup (compte migré) : sert à reconnaître ce compte s'il est ajouté de nouveau. */
export function rememberLogin(id: string, login: string) {
  if (!accounts.some((a) => a.id === id && !a.login)) return
  accounts = accounts.map((a) => (a.id === id ? { ...a, login } : a))
  persist()
}

/** Déconnecte un compte, ou tous sans argument. */
export async function logout(id?: string) {
  for (const a of accounts.filter((a) => !id || a.id === id)) {
    await invoke("delete_token", { account: a.id }).catch(() => {})
    tokens.delete(a.id)
  }
  accounts = id ? accounts.filter((a) => a.id !== id) : []
  persist()
  skipGh(true)
  set(accounts.length ? "signed-in" : "signed-out")
}

/** Désinstallation : efface les jetons de tous les comptes du trousseau, sans changer d'écran. */
export const forgetTokens = () =>
  Promise.all(
    accounts.map((a) =>
      invoke("delete_token", { account: a.id }).catch(() => {}),
    ),
  )

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
