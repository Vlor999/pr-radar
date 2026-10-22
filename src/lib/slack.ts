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
/** attente maximale demandée par Slack (ou un proxy) avant de réessayer */
const MAX_RETRY_S = 60
/** noms des DM lus en parallèle dans les réglages (users.info : palier 4, ~100 appels / min) */
const NAME_CONCURRENCY = 4
/** révocation à la déconnexion : la désinstallation ne doit jamais rester bloquée */
const REVOKE_TIMEOUT_MS = 5_000
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

/** PR à (re)chercher : jamais lues, ou lues (ou en échec) il y a plus de 10 min. */
export const dueUrls = (
  urls: string[],
  cache: Map<string, { at: number }>,
  now: number,
) => urls.filter((u) => (cache.get(u)?.at ?? 0) < now - CACHE_TTL_MS)

/** File de lecture complétée par de nouvelles PR : sans doublon, sans la PR en cours de lecture. */
export const mergeQueue = (
  queue: string[],
  urls: string[],
  reading: string | null,
) => [...new Set([...queue, ...urls])].filter((u) => u !== reading)

/** Première relecture automatique des PR affichées : leur plus ancienne lecture + 10 min (aucune lue : `null`). */
export const nextReadAt = (
  urls: string[],
  cache: Map<string, { at: number }>,
) => {
  const ats = urls.flatMap((u) => cache.get(u)?.at ?? [])
  return ats.length ? Math.min(...ats) + CACHE_TTL_MS : null
}

/** Retour du lien profond `prradar://oauth?…` attendu par cette tentative de connexion. */
export const matchesState = (query: string, expected: string) =>
  new URLSearchParams(query).get("state") === expected

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

/** Rien de visible n'a changé : pas de notification (sinon l'effet du tableau de bord relance la file). */
export const sameState = (a: SlackState, b: SlackState) =>
  a.team?.id === b.team?.id &&
  a.team?.name === b.team?.name &&
  a.expired === b.expired &&
  a.error === b.error

function setState(next: SlackState) {
  if (sameState(state, next)) return
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
 * `Retry-After` absent, invalide ou ≤ 0 : 30 s ; plafonné à 60 s. `null` : pas de limite atteinte.
 */
export function rateLimitWait(
  status: number,
  error: string | undefined,
  retryAfter: string | null,
): number | null {
  if (status !== 429 && error !== "ratelimited") return null
  const s = Number(retryAfter)
  return s > 0 ? Math.min(s, MAX_RETRY_S) : DEFAULT_RETRY_S
}

/** Erreur renvoyée par l'API Slack : `code` est son champ `error` (ou `HTTP <status>`). */
export class SlackError extends Error {
  code: string
  constructor(method: string, code: string) {
    super(`Slack ${method} : ${code}`)
    this.code = code
  }
}

/** Jeton refusé par Slack : reconnexion nécessaire. Le reste (réseau, 5xx, limite) est passager. */
export const isAuthError = (e: unknown) =>
  e instanceof SlackError && AUTH_ERRORS.includes(e.code)

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
    const error = new SlackError(method, json.error ?? `HTTP ${res.status}`)
    if (token && state.team && isAuthError(error))
      setState({ ...state, expired: true })
    throw error
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
export const toTokens = (
  r: OAuthUser & { authed_user?: OAuthUser },
  now = Date.now(),
): Tokens => {
  const u = r.authed_user?.access_token ? r.authed_user : r
  if (!u.access_token) throw new Error("Slack : no user token")
  return {
    access: u.access_token,
    refresh: u.refresh_token ?? null,
    expiresAt: u.expires_in ? now + u.expires_in * 1000 : null,
  }
}

const account = (team: Team) => `slack:${team.id}`
let tokens: Tokens | null = null
/** un seul renouvellement à la fois : avec la rotation, l'ancien refresh token est invalidé */
let refreshing: Promise<Tokens> | null = null
/** jetons renouvelés pas encore écrits au trousseau (trousseau verrouillé) : réessayé au prochain appel */
let unsaved = false

const save = (team: Team, t: Tokens) =>
  invoke("set_token", { account: account(team), token: JSON.stringify(t) })
    .then(() => (unsaved = false))
    .catch(() => (unsaved = true))

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
  if (unsaved) void save(team, tokens)
  if (needsRefresh(tokens.expiresAt, Date.now()) && tokens.refresh) {
    const refresh = tokens.refresh
    refreshing ??= call<OAuthUser>("oauth.v2.access", {
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refresh,
    })
      .then((r) => toTokens(r))
      .then((t) => {
        // en mémoire d'abord : l'ancien refresh token n'est déjà plus valable
        tokens = t
        void save(team, t)
        return t
      })
      .catch((e: unknown) => {
        // refresh token refusé : reconnexion ; sinon (réseau, 5xx, limite) jetons gardés, nouvel essai au prochain cycle
        if (isAuthError(e)) setState({ ...state, expired: true })
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
    // un lien `prradar://oauth` d'une autre origine (state différent) est ignoré : on attend le bon
    listen<string>("slack-oauth", (e) => {
      if (matchesState(e.payload, expected)) resolve(e.payload)
    }).then((u) => (unlisten = u), reject)
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
  generation++
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
  setProgress()
  setState({ team, expired: false })
}

/**
 * Révoque le jeton enregistré (au mieux, 5 s au plus, sans renouvellement même si la session a expiré),
 * l'efface du trousseau, oublie les choix de conversations.
 */
export async function disconnectSlack() {
  const team = state.team
  if (!team) return
  generation++ // une recherche en cours n'écrit plus rien
  queue = []
  const stored =
    tokens ??
    (await invoke<string | null>("get_token", { account: account(team) })
      .then((raw) => (raw ? (JSON.parse(raw) as Tokens) : null))
      .catch(() => null))
  if (stored)
    await Promise.race([
      call("auth.revoke", {}, stored.access).catch(() => {}),
      sleep(REVOKE_TIMEOUT_MS),
    ])
  await invoke("delete_token", { account: account(team) }).catch(() => {})
  tokens = null
  unsaved = false
  mentions.clear()
  setProgress()
  userNames.clear()
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

/**
 * Channels publics et privés, DM et DM de groupe (`conversations.list`, paginé). Un DM porte d'abord
 * l'id de son destinataire (ou son nom déjà connu) ; les noms manquants sont lus ensuite, 4 à la fois,
 * et `onNamed` reçoit la liste complétée. Un échec (limite Slack comprise) arrête la lecture des noms
 * et s'affiche comme erreur Slack ; les DM restants gardent leur id.
 */
export async function listConversations(
  onNamed: (list: SlackConversation[]) => void,
): Promise<SlackConversation[]> {
  const t = await token()
  const out: SlackConversation[] = []
  const dmUser = new Map<string, string>() // id de conversation → id du destinataire
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
      if (c.is_im && c.user) dmUser.set(c.id, c.user)
      const name = c.is_im
        ? (userNames.get(c.user ?? "") ?? c.user ?? c.id)
        : c.is_mpim
          ? mpdmName(c.name ?? "")
          : (c.name ?? c.id)
      out.push({ id: c.id, name, kind })
    }
    cursor = r.response_metadata?.next_cursor ?? ""
  } while (cursor)
  const missing = [...new Set(dmUser.values())].filter((u) => !userNames.has(u))
  if (missing.length)
    void nameUsers(missing, t).then(() =>
      onNamed(
        out.map((c) => {
          const u = dmUser.get(c.id)
          return u && userNames.has(u) ? { ...c, name: userNames.get(u)! } : c
        }),
      ),
    )
  return out
}

/** Lit les noms manquants, NAME_CONCURRENCY à la fois ; arrêt au premier échec, affiché comme erreur Slack. */
async function nameUsers(ids: string[], t: string) {
  const todo = [...ids]
  let failed = false
  const worker = async () => {
    while (todo.length && !failed) {
      const id = todo.shift()!
      await userName(id, t).catch((e: unknown) => {
        failed = true
        setState({
          ...state,
          error: e instanceof Error ? e.message : String(e),
        })
      })
    }
  }
  await Promise.all(Array.from({ length: NAME_CONCURRENCY }, worker))
}

/* ---------- Mentions des PR : cache 10 min, file d'attente à ~1 requête / 3 s ---------- */

const NONE: SlackMention[] = []
const mentions = new Map<string, { at: number; list: SlackMention[] }>()
let queue: string[] = []
let draining = false
/** PR en cours de recherche (hors de la file) */
let reading: string | null = null
/** PR ajoutées à la file depuis le début de la lecture en cours */
let total = 0
/** fin de la dernière lecture arrivée au bout de sa file */
let completedAt: number | null = null
/** PR affichées par le tableau de bord (dernier appel à `refreshMentions`) */
let shown: string[] = []
/** change à chaque connexion / déconnexion : les résultats d'une recherche lancée avant sont jetés */
let generation = 0

export type SlackProgress = {
  /** lecture des mentions en cours (automatique ou forcée) */
  running: boolean
  /** PR lues / PR à lire dans la lecture en cours (ou la dernière) */
  done: number
  total: number
  /** PR affichées : ce que relit une actualisation forcée */
  known: number
  /** première relecture automatique possible (plus ancienne lecture + 10 min) */
  nextAt: number | null
  /** fin de la dernière lecture complète (pas arrêtée : limite, session expirée, déconnexion) */
  completedAt: number | null
}
let progress: SlackProgress = {
  running: false,
  done: 0,
  total: 0,
  known: 0,
  nextAt: null,
  completedAt: null,
}

function setProgress() {
  progress = {
    running: draining,
    done: total - queue.length - (reading ? 1 : 0),
    total,
    known: shown.length,
    nextAt: nextReadAt(shown, mentions),
    completedAt,
  }
  emit()
}

export const useSlackProgress = () =>
  useSyncExternalStore(subscribe, () => progress)

const active = () => {
  const s = getSettings()
  return (
    !!state.team && !state.expired && (s.slackAll || s.slackChannels.length > 0)
  )
}

async function drain() {
  draining = true
  let stopped = false
  while (queue.length && active()) {
    const url = queue.shift()!
    reading = url
    const gen = generation
    setProgress()
    try {
      const t = await token()
      const r = await call<{ messages: { matches: Match[] } }>(
        "search.messages",
        { query: url, count: "100", sort: "timestamp" },
        t,
      )
      const matches = r.messages.matches.filter((m) => mentionsUrl(m.text, url))
      for (const id of userIds(matches)) await userName(id, t).catch(() => {})
      if (gen !== generation) {
        stopped = true
        break
      }
      mentions.set(url, {
        at: Date.now(),
        list: toMentions(matches, url, userNames),
      })
      setState({ ...state, error: undefined })
    } catch (e) {
      if (gen !== generation || state.expired) {
        stopped = true
        break
      }
      // échec : même délai qu'un succès avant la prochaine recherche de cette PR (anciennes mentions gardées)
      mentions.set(url, {
        at: Date.now(),
        list: mentions.get(url)?.list ?? NONE,
      })
      setState({ ...state, error: e instanceof Error ? e.message : String(e) })
      // limite toujours atteinte après 3 essais : arrêt jusqu'à la prochaine actualisation
      if (e instanceof SlackError && e.code === "ratelimited") {
        queue = []
        stopped = true
      }
    }
    reading = null
    setProgress()
    await sleep(THROTTLE_MS)
  }
  reading = null
  draining = false
  if (!stopped && active()) completedAt = Date.now()
  setProgress()
}

/** Ajoute des PR à la file (lecture en cours : à la suite) et lance la lecture si besoin. */
function enqueue(urls: string[]) {
  const next = mergeQueue(queue, urls, reading)
  if (next.length === queue.length) return
  total = draining ? total + next.length - queue.length : next.length
  queue = next
  if (!draining) void drain()
}

/** Relit les mentions des PR pas vues depuis 10 min (appelé à chaque actualisation GitHub). */
export function refreshMentions(prs: Pr[]) {
  shown = prs.map((p) => p.url)
  if (active()) enqueue(dueUrls(shown, mentions, Date.now()))
  setProgress()
}

/** Relit tout de suite les mentions des PR affichées, sans attendre les 10 min (bouton des réglages). */
export function forceRefreshMentions() {
  if (!active()) return
  enqueue(shown)
  setProgress()
}

/** Mentions d'une PR dans les conversations choisies. */
export function useMentions(url: string): SlackMention[] {
  const list = useSyncExternalStore(
    subscribe,
    () => mentions.get(url)?.list ?? NONE,
  )
  const s = useSettings()
  return useSlack().team ? filterMentions(list, s) : NONE
}
