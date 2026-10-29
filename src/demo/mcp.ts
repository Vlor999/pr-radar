// Démo navigateur : même API que src/lib/mcp.ts, historique fictif (repos acme/globex), aucun socket.
import { useSyncExternalStore } from "react"

import { getSettings, updateSettings } from "@/lib/settings"
import type { McpCall, McpInfo } from "@/lib/types"

export type McpState = {
  info: McpInfo | null
  running: boolean
  error?: string
}

const INFO: McpInfo = {
  exe: "/Applications/PR Radar.app/Contents/MacOS/pr-radar",
  socket:
    "/Users/me/Library/Application Support/io.github.vlor999.prradar/mcp.sock",
  supported: true,
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

const HISTORY: McpCall[] = [
  {
    at: ago(2),
    client: "claude-code",
    tool: "get_prs",
    args: {},
    ms: 4,
    ok: true,
    bytes: 18_432,
  },
  {
    at: ago(3),
    client: "claude-code",
    tool: "get_pr",
    args: { url: "https://github.com/acme/web/pull/412" },
    ms: 6,
    ok: true,
    bytes: 7_210,
  },
  {
    at: ago(25),
    client: "cursor",
    tool: "get_pr",
    args: { url: "https://github.com/acme/api/pull/999" },
    ms: 2,
    ok: false,
    error:
      "PR not found among your open PRs in PR Radar: https://github.com/acme/api/pull/999",
    bytes: 0,
  },
  {
    at: ago(40),
    client: "cursor",
    tool: "get_prs",
    args: {},
    ms: 5_000,
    ok: false,
    error: "timeout",
    bytes: 0,
  },
  {
    at: ago(26 * 60),
    client: "claude-code",
    tool: "get_pr",
    args: { url: "https://github.com/globex/billing/pull/7" },
    ms: 5,
    ok: true,
    bytes: 3_388,
  },
]

let state: McpState = { info: INFO, running: getSettings().mcpEnabled }
let history = HISTORY
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useMcp = () => useSyncExternalStore(subscribe, () => state)
export const useMcpHistory = () =>
  useSyncExternalStore(subscribe, () => history)

export function clearMcpHistory() {
  history = []
  emit()
}

export async function setMcpEnabled(on: boolean) {
  updateSettings({ mcpEnabled: on })
  state = { ...state, running: on, error: undefined }
  emit()
}

export async function startMcp() {}
