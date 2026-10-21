import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { fetch } from "@tauri-apps/plugin-http"
import { useSyncExternalStore } from "react"

// extensions : chargé aussi par node --test
import { openExternal } from "./open.ts"
import {
  getSettings,
  updateSettings,
  useSettings,
  type Settings,
} from "./settings.ts"
import type { Pr, SlackConversation, SlackMention } from "./types.ts"

/**
 * Mentions Slack des PR, sans serveur : app Slack publique en PKCE (pas de secret), retour par
 * le lien profond `prradar://oauth` (relayé par Rust en événement `slack-oauth`). Jetons dans le trousseau
 * (`slack:<team_id>`), localStorage : seulement l'équipe connectée. Un seul workspace.
 */

/** App Slack « PR Radar ». L'identifiant est public, ce n'est pas un secret. */
const CLIENT_ID: string =
  import.meta.env?.VITE_SLACK_CLIENT_ID || "1916463416562.12372389120262"
const REDIRECT_URI = "prradar://oauth"
/** abandon de la connexion si Slack n'a pas renvoyé vers l'app */
const OAUTH_TIMEOUT_MS = 5 * 60_000

const USER_SCOPE =
  "search:read,channels:read,groups:read,im:read,mpim:read,users:read"
const API = "https://slack.com/api/"
/** une PR n'est recherchée qu'une fois par période */
const CACHE_TTL_MS = 10 * 60_000
/** search.messages : palier 2 de Slack, ~20 requêtes / min */
const THROTTLE_MS = 3_000
/** jeton renouvelé quand il expire dans moins de 5 min (rotation : durée de vie 12 h) */
const REFRESH_MARGIN_MS = 5 * 60_000
const TEAM_KEY = "pr-radar:slack"
/** tentatives d'un appel limité par Slack avant d'abandonner */
const MAX_TRIES = 3
const DEFAULT_RETRY_S = 30
const AUTH_ERRORS = [
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "invalid_refresh_token",
]

/* ---------- Logique pure (testée) ---------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Le texte contient le lien de la PR, pas celui d'une autre (`/pull/12` ≠ `/pull/123`). */
export const mentionsUrl = (text: string, url: string) =>
  new RegExp(`${escapeRe(url)}(?=$|[/#|>])`, "i").test(text)

/** Participants d'un DM de groupe d'après son nom : `mpdm-alice--bob--carol-1` → `alice, bob, carol`. */
export const mpdmName = (name: string) =>
  name
    .replace(/^mpdm-|-\d+$/g, "")
    .split("--")
    .join(", ")

/** Ids des utilisateurs à nommer : cités (`<@U…>`), ou destinataire d'un DM (nom du channel). */
export const userIds = (matches: Match[]) => [
  ...new Set(
    matches.flatMap((m) => [
      ...[...m.text.matchAll(/<@([UW][A-Z0-9]+)>/g)].map((x) => x[1]),
      ...(m.channel.is_im && m.channel.name ? [m.channel.name] : []),
    ]),
  ),
]

export const needsRefresh = (expiresAt: number | null, now: number) =>
  expiresAt !== null && expiresAt - now < REFRESH_MARGIN_MS

/** Mentions des conversations choisies ; rien de choisi : aucune. */
export const filterMentions = (
  list: SlackMention[],
  s: Pick<Settings, "slackAll" | "slackChannels">,
) =>
  s.slackAll ? list : list.filter((m) => s.slackChannels.includes(m.channelId))

type Match = {
  username?: string
  ts: string
  text: string
  permalink: string
  channel: { id: string; name?: string; is_im?: boolean; is_mpim?: boolean }
}

/** Résultats de `search.messages` qui contiennent vraiment le lien de la PR. */
export const toMentions = (
  matches: Match[],
  url: string,
  names: Map<string, string> = new Map(),
): SlackMention[] =>
  matches
    .filter((m) => mentionsUrl(m.text, url))
    .map((m) => {
      const c = m.channel
      const name = c.name ?? ""
      return {
        author: m.username ?? "?",
        channelId: c.id,
        where: c.is_im
          ? `DM · ${names.get(name) ?? name}`
          : c.is_mpim
            ? `DM · ${mpdmName(name)}`
            : `#${name}`,
        at: new Date(Number(m.ts) * 1000).toISOString(),
        // mrkdwn gardé (src/lib/slack-text.ts), mentions nommées : `<@U1>` → `<@U1|Alice>`
        text: m.text.replace(/<@([UW][A-Z0-9]+)>/g, (x, id: string) =>
          names.has(id) ? `<@${id}|${names.get(id)}>` : x,
        ),
        permalink: m.permalink,
      }
    })

/* ---------- État : équipe connectée, session expirée ---------- */

type Team = { id: string; name: string }
export type SlackState = {
  team: Team | null
  expired: boolean
  /** dernière recherche de mentions en échec (effacée au premier succès) */
  error?: string
}

const readTeam = (): Team | null => {
  try {
    return JSON.parse(localStorage.getItem(TEAM_KEY) ?? "null") as Team | null
  } catch {
    return null
  }
}

let state: SlackState = { team: readTeam(), expired: false }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function setState(next: SlackState) {
  state = next
  try {
    if (next.team) localStorage.setItem(TEAM_KEY, JSON.stringify(next.team))
    else localStorage.removeItem(TEAM_KEY)
  } catch {}
  emit()
}

export const useSlack = () => useSyncExternalStore(subscribe, () => state)

/* ---------- API Slack et jetons ---------- */

/**
 * Attente demandée par Slack, en secondes : HTTP 429, ou `ok: false, error: "ratelimited"`.
 * Sans en-tête `Retry-After` lisible : 30 s. `null` : pas de limite atteinte.
 */
export const rateLimitWait = (
  status: number,
  error: string | undefined,
  retryAfter: string | null,
): number | null =>
  status === 429 || error === "ratelimited"
    ? Number(retryAfter) || DEFAULT_RETRY_S
    : null

/** Appel de l'API Slack ; limite atteinte : attend `Retry-After` et réessaie (3 fois au plus). */
async function call<T>(
  method: string,
  params: Record<string, string>,
  token?: string,
  tries = 1,
): Promise<T> {
  const res = await fetch(API + method, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: new URLSearchParams(params).toString(),
  })
  const json = (await res.json().catch(() => ({ ok: false }))) as {
    ok: boolean
    error?: string
  }
  const wait = rateLimitWait(
    res.status,
    json.error,
    res.headers.get("Retry-After"),
  )
  if (wait !== null && tries < MAX_TRIES) {
    await sleep(wait * 1000)
    return call(method, params, token, tries + 1)
  }
  if (!json.ok) {
    if (token && AUTH_ERRORS.includes(json.error ?? ""))
      setState({ ...state, expired: true })
    throw new Error(`Slack ${method} : ${json.error ?? `HTTP ${res.status}`}`)
  }
  return json as T
}

type Tokens = {
  access: string
  refresh: string | null
  expiresAt: number | null
}
type OAuthUser = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

/** Réponse de `oauth.v2.access` : jeton utilisateur dans `authed_user` (code) ou à la racine (refresh). */
const toTokens = (r: OAuthUser & { authed_user?: OAuthUser }): Tokens => {
  const u = r.authed_user?.access_token ? r.authed_user : r
  if (!u.access_token) throw new Error("Slack : no user token")
  return {
    access: u.access_token,
    refresh: u.refresh_token ?? null,
    expiresAt: u.expires_in ? Date.now() + u.expires_in * 1000 : null,
  }
}

const account = (team: Team) => `slack:${team.id}`
let tokens: Tokens | null = null
/** un seul renouvellement à la fois : avec la rotation, l'ancien refresh token est invalidé */
let refreshing: Promise<Tokens> | null = null

async function token(): Promise<string> {
  const team = state.team
  if (!team || state.expired) throw new Error("Slack : not connected")
  if (!tokens) {
    const raw = await invoke<string | null>("get_token", {
      account: account(team),
    })
    tokens = raw ? (JSON.parse(raw) as Tokens) : null
  }
  if (!tokens) {
    setState({ ...state, expired: true })
    throw new Error("Slack : not connected")
  }
  if (needsRefresh(tokens.expiresAt, Date.now()) && tokens.refresh) {
    const refresh = tokens.refresh
    refreshing ??= call<OAuthUser>("oauth.v2.access", {
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refresh,
    })
      .then(toTokens)
      .then(async (t) => {
        await invoke("set_token", {
          account: account(team),
          token: JSON.stringify(t),
        })
        return (tokens = t)
      })
      .catch((e: unknown) => {
        setState({ ...state, expired: true })
        throw e
      })
      .finally(() => (refreshing = null))
    return (await refreshing).access
  }
  return tokens.access
}

/* ---------- Connexion (OAuth v2, PKCE S256) ---------- */

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

const randomString = (n: number) =>
  base64url(crypto.getRandomValues(new Uint8Array(n)))

export const pkceChallenge = async (verifier: string) =>
  base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  )

let attempt = 0

/** Ouvre l'autorisation Slack dans le navigateur, attend le retour (5 min), garde les jetons. */
export async function connectSlack() {
  const id = ++attempt
  const verifier = randomString(32)
  const challenge = await pkceChallenge(verifier)
  const expected = randomString(16)
  let unlisten = () => {}
  let timer = 0
  const query = new Promise<string>((resolve, reject) => {
    timer = window.setTimeout(() => reject("timeout"), OAUTH_TIMEOUT_MS)
    listen<string>("slack-oauth", (e) => resolve(e.payload)).then(
      (u) => (unlisten = u),
      reject,
    )
  })
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    user_scope: USER_SCOPE,
    redirect_uri: REDIRECT_URI,
    state: expected,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })
  openExternal(`https://slack.com/oauth/v2/authorize?${q}`)
  const back = new URLSearchParams(
    await query.finally(() => {
      clearTimeout(timer)
      unlisten()
    }),
  )
  if (id !== attempt) return // une autre tentative a démarré entre-temps
  if (back.get("state") !== expected) throw new Error("Slack : invalid state")
  const code = back.get("code")
  if (!code) throw new Error(`Slack : ${back.get("error") ?? "no code"}`)
  const r = await call<OAuthUser & { authed_user?: OAuthUser; team?: Team }>(
    "oauth.v2.access",
    {
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    },
  )
  const t = toTokens(r)
  if (!r.team) throw new Error("Slack : no team")
  const team = { id: r.team.id, name: r.team.name }
  if (state.team && state.team.id !== team.id)
    await invoke("delete_token", { account: account(state.team) }).catch(
      () => {},
    )
  await invoke("set_token", {
    account: account(team),
    token: JSON.stringify(t),
  })
  tokens = t
  mentions.clear()
  setState({ team, expired: false })
}

/** Révoque le jeton (au mieux), l'efface du trousseau, oublie les choix de conversations. */
export async function disconnectSlack() {
  const team = state.team
  if (!team) return
  await token()
    .then((t) => call("auth.revoke", {}, t))
    .catch(() => {})
  await invoke("delete_token", { account: account(team) }).catch(() => {})
  tokens = null
  queue = []
  mentions.clear()
  updateSettings({ slackAll: false, slackChannels: [] })
  setState({ team: null, expired: false })
}

/* ---------- Conversations (réglages) ---------- */

const userNames = new Map<string, string>()

async function userName(id: string, t: string) {
  if (!userNames.has(id)) {
    const r = await call<{
      user: { name: string; real_name?: string }
    }>("users.info", { user: id }, t)
    userNames.set(id, r.user.real_name || r.user.name)
  }
  return userNames.get(id) ?? id
}

const KIND = {
  public: (c: Conv) => !c.is_private && !c.is_im && !c.is_mpim,
  private: (c: Conv) => !!c.is_private && !c.is_mpim,
  im: (c: Conv) => !!c.is_im,
  mpim: (c: Conv) => !!c.is_mpim,
}

type Conv = {
  id: string
  name?: string
  user?: string
  is_private?: boolean
  is_im?: boolean
  is_mpim?: boolean
}

/** Channels publics et privés, DM et DM de groupe (`conversations.list`, paginé). */
export async function listConversations(): Promise<SlackConversation[]> {
  const t = await token()
  const out: SlackConversation[] = []
  let cursor = ""
  do {
    const r = await call<{
      channels: Conv[]
      response_metadata?: { next_cursor?: string }
    }>(
      "conversations.list",
      {
        types: "public_channel,private_channel,im,mpim",
        exclude_archived: "true",
        limit: "1000", // maximum de Slack : moins de pages (palier 2, ~20 appels / min)
        cursor,
      },
      t,
    )
    for (const c of r.channels) {
      const kind = (Object.keys(KIND) as (keyof typeof KIND)[]).find((k) =>
        KIND[k](c),
      )!
      const name = c.is_im
        ? await userName(c.user ?? "", t).catch(() => c.user ?? c.id)
        : c.is_mpim
          ? mpdmName(c.name ?? "")
          : (c.name ?? c.id)
      out.push({ id: c.id, name, kind })
    }
    cursor = r.response_metadata?.next_cursor ?? ""
  } while (cursor)
  return out
}

/* ---------- Mentions des PR : cache 10 min, file d'attente à ~1 requête / 3 s ---------- */

const mentions = new Map<string, { at: number; list: SlackMention[] }>()
let queue: string[] = []
let draining = false

const active = () => {
  const s = getSettings()
  return (
    !!state.team && !state.expired && (s.slackAll || s.slackChannels.length > 0)
  )
}

async function drain() {
  draining = true
  while (queue.length && active()) {
    const url = queue.shift()!
    try {
      const t = await token()
      const r = await call<{ messages: { matches: Match[] } }>(
        "search.messages",
        { query: url, count: "100", sort: "timestamp" },
        t,
      )
      const matches = r.messages.matches.filter((m) => mentionsUrl(m.text, url))
      for (const id of userIds(matches)) await userName(id, t).catch(() => {})
      mentions.set(url, {
        at: Date.now(),
        list: toMentions(matches, url, userNames),
      })
      emit()
      if (state.error) setState({ ...state, error: undefined })
    } catch (e) {
      if (state.expired) break
      setState({ ...state, error: e instanceof Error ? e.message : String(e) })
    }
    await sleep(THROTTLE_MS)
  }
  draining = false
}

/** Relit les mentions des PR pas vues depuis 10 min (appelé à chaque actualisation GitHub). */
export function refreshMentions(prs: Pr[]) {
  if (!active()) return
  const now = Date.now()
  queue = prs
    .map((p) => p.url)
    .filter((u) => (mentions.get(u)?.at ?? 0) < now - CACHE_TTL_MS)
  if (!draining) void drain()
}

const NONE: SlackMention[] = []

/** Mentions d'une PR dans les conversations choisies. */
export function useMentions(url: string): SlackMention[] {
  const list = useSyncExternalStore(
    subscribe,
    () => mentions.get(url)?.list ?? NONE,
  )
  const s = useSettings()
  return useSlack().team ? filterMentions(list, s) : NONE
}
