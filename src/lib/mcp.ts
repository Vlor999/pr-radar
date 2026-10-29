import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useSyncExternalStore } from "react"

import {
  htmlToText,
  parentsOf,
  parseHistory,
  prPayload,
  prsPayload,
  pushCall,
  slackStatus,
  type McpContext,
  type McpReply,
  type MentionsOf,
} from "./mcp-data"
import { getSettings, updateSettings } from "./settings"
import {
  cachedMentions,
  filterMentions,
  getSlackProgress,
  getSlackState,
} from "./slack"
import { getData } from "./store"
import { saveItem } from "./sync"
import type { McpCall, McpInfo } from "./types"

/**
 * Serveur MCP local, en lecture seule. Rust reçoit l'appel du shim (`pr-radar --mcp`) sur le socket,
 * émet `mcp-request` ; la réponse est calculée ici depuis les stores (aucun appel réseau) et renvoyée
 * par `mcp_response`. Sans réponse en 5 s, Rust répond une erreur et émet `mcp-timeout`.
 */

const HISTORY_KEY = "pr-radar:mcp-history"

type Request = { id: number; tool: string; args: unknown; client: string }
type Timeout = { tool: string; args: unknown; client: string; ms: number }

/* ---------- État : infos du binaire, serveur actif, dernière erreur ---------- */

export type McpState = {
  info: McpInfo | null
  /** socket ouvert */
  running: boolean
  error?: string
}

let state: McpState = { info: null, running: false }
let history: McpCall[] = (() => {
  try {
    return parseHistory(localStorage.getItem(HISTORY_KEY))
  } catch {
    return []
  }
})()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const setState = (patch: Partial<McpState>) => {
  state = { ...state, ...patch }
  emit()
}

export const useMcp = () => useSyncExternalStore(subscribe, () => state)
export const useMcpHistory = () =>
  useSyncExternalStore(subscribe, () => history)

const saveHistory = () => saveItem(HISTORY_KEY, JSON.stringify(history))

function record(call: McpCall) {
  history = pushCall(history, call)
  saveHistory()
  emit()
}

export function clearMcpHistory() {
  history = []
  saveHistory()
  emit()
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Active ou désactive le serveur : socket créé ou supprimé, réglage enregistré si Rust a réussi. */
export async function setMcpEnabled(on: boolean) {
  try {
    await invoke(on ? "mcp_enable" : "mcp_disable")
    updateSettings({ mcpEnabled: on })
    setState({ running: on, error: undefined })
  } catch (e) {
    // désactivation en échec : le socket est peut-être encore ouvert, l'état affiché ne change pas
    setState(on ? { running: false, error: message(e) } : { error: message(e) })
  }
}

/* ---------- Réponses ---------- */

function context(): McpContext {
  const d = getData()
  const s = getSlackState()
  const p = getSlackProgress()
  const settings = getSettings()
  return {
    fetchedAt: d.fetchedAt || null,
    loading: d.loading,
    error: d.error ?? null,
    slack: {
      status: slackStatus({
        connected: !!s.team,
        expired: s.expired,
        active: settings.slackAll || settings.slackChannels.length > 0,
      }),
      queue: p.running ? p.total - p.done : 0,
      error: s.error ?? null,
    },
  }
}

const toText = (html: string) =>
  htmlToText(new DOMParser().parseFromString(html, "text/html").body)

function answer(tool: string, args: unknown): McpReply {
  const ctx = context()
  const d = getData()
  const settings = getSettings()
  const mentionsOf: MentionsOf = (url) => {
    if (ctx.slack.status === "disabled") return null
    const c = cachedMentions(url)
    return c ? { at: c.at, list: filterMentions(c.list, settings) } : null
  }
  const parents = parentsOf(d.trees)
  if (tool === "get_prs")
    return {
      text: JSON.stringify(
        prsPayload(ctx, d.prs, d.reviews.reviews, parents, mentionsOf),
      ),
    }
  if (tool === "get_pr") {
    const url = (args as { url?: unknown } | null)?.url
    if (typeof url !== "string") return { error: "get_pr: missing `url`" }
    const r = prPayload(
      ctx,
      url,
      d.prs,
      d.reviews.reviews,
      parents,
      mentionsOf,
      toText,
    )
    return r.ok ? { text: JSON.stringify(r.data) } : { error: r.error }
  }
  return { error: `Unknown tool: ${tool}` }
}

async function onRequest({ id, tool, args, client }: Request) {
  const start = performance.now()
  let reply: McpReply
  try {
    reply = answer(tool, args)
  } catch (e) {
    reply = { error: `PR Radar: ${message(e)}` }
  }
  const json = JSON.stringify(reply)
  try {
    await invoke("mcp_response", { id, json })
  } catch {
    return // arrivée après les 5 s : déjà journalisée par `mcp-timeout`
  }
  record({
    at: new Date().toISOString(),
    client,
    tool,
    args,
    ms: Math.round(performance.now() - start),
    ok: "text" in reply,
    ...("error" in reply && { error: reply.error }),
    bytes: new TextEncoder().encode("text" in reply ? reply.text : "").length,
  })
}

let started = false
/** écoute des événements Rust, enregistrée une seule fois */
let listening = false

const onTimeout = (p: Timeout) =>
  record({
    at: new Date().toISOString(),
    client: p.client,
    tool: p.tool,
    args: p.args,
    ms: p.ms,
    ok: false,
    error: "timeout",
    bytes: 0,
  })

/** Écoute `mcp-request` et `mcp-timeout` ; un échec retire l'écoute déjà posée (pas de doublon au nouvel essai). */
async function listenAll() {
  if (listening) return
  const results = await Promise.allSettled([
    listen<Request>("mcp-request", (e) => void onRequest(e.payload)),
    listen<Timeout>("mcp-timeout", (e) => onTimeout(e.payload)),
  ])
  const failed = results.find((r) => r.status === "rejected")
  if (failed) {
    results.forEach((r) => r.status === "fulfilled" && r.value())
    throw failed.reason
  }
  listening = true
}

/**
 * Au lancement de l'app (connecté ou non) : infos du binaire, écoute des requêtes, puis socket aligné
 * sur le réglage. L'écoute précède l'ouverture du socket. Après un rechargement de la webview, Rust
 * garde son socket : réglage désactivé → fermé, activé → gardé (`mcp_enable` ne recrée rien).
 * Échec (infos, écoute) : `started` revient à false, le prochain appel réessaie.
 */
export async function startMcp() {
  if (started) return
  started = true
  try {
    const info = await invoke<McpInfo>("mcp_info")
    setState({ info })
    if (!info.supported) return
    await listenAll()
  } catch (e) {
    started = false
    setState({ error: message(e) })
    return
  }
  const on = getSettings().mcpEnabled
  await invoke(on ? "mcp_enable" : "mcp_disable")
    .then(() => setState({ running: on, error: undefined }))
    .catch((e: unknown) =>
      setState(
        on ? { running: false, error: message(e) } : { error: message(e) },
      ),
    )
}
