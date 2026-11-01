// Démo navigateur : journal d'activité local (src-tauri/src/log.rs) gardé en mémoire, avec des entrées plausibles.
import type { LogEntry, LogLevel } from "@/lib/types"

const DEFAULT_DIR = "/Users/demo/Library/Logs/io.github.vlor999.prradar"
const PICKED_DIR = "/Users/demo/Documents/pr-radar-logs"
const LEVELS: LogLevel[] = ["info", "warn", "error"]
const MIN = 60_000

const ago = (min: number) => Date.now() - min * MIN

/** du plus ancien au plus récent, comme dans le fichier */
let entries: LogEntry[] = [
  {
    ts: ago(185),
    level: "info",
    event: "app.start",
    data: { version: "0.0.0-demo", os: "macOS" },
  },
  {
    ts: ago(184),
    level: "info",
    event: "refresh",
    data: { ms: 1240, measure: true, repos: 4, prs: 9, reviews: 3 },
  },
  {
    ts: ago(184),
    level: "info",
    event: "refresh.quota",
    data: { accounts: [{ account: "github", remaining: 4890, cost: 12 }] },
  },
  {
    ts: ago(150),
    level: "info",
    event: "mcp.call",
    data: { tool: "get_prs", client: "claude-code", ok: true, ms: 4 },
  },
  {
    ts: ago(120),
    level: "warn",
    event: "slack.error",
    data: { method: "search.messages", code: "ratelimited" },
  },
  {
    ts: ago(95),
    level: "info",
    event: "action",
    data: { action: "ready", repo: "acme/web", ok: true, pr: 42 },
  },
  {
    ts: ago(70),
    level: "warn",
    event: "github.error",
    data: { account: "github", status: 502, error: "HTTP 502" },
  },
  {
    ts: ago(70),
    level: "warn",
    event: "refresh",
    data: {
      ms: 3120,
      measure: true,
      repos: 4,
      prs: 9,
      reviews: 3,
      errors: [{ account: "github", error: "HTTP 502" }],
    },
  },
  {
    ts: ago(40),
    level: "error",
    event: "action",
    data: {
      action: "syncBranch",
      repo: "globex/billing",
      ok: false,
      pr: 7,
      error: "Merge conflict",
    },
  },
  {
    ts: ago(12),
    level: "info",
    event: "action",
    data: { action: "comment", repo: "acme/api", ok: true, pr: 118 },
  },
  {
    ts: ago(5),
    level: "info",
    event: "refresh",
    data: { ms: 980, measure: true, repos: 4, prs: 10, reviews: 2 },
  },
]

const dirOf = (dir: unknown) => (typeof dir === "string" && dir) || DEFAULT_DIR

export const logCommands = {
  log_dir: ({ dir }: Record<string, unknown>) => ({
    dir: dirOf(dir),
    defaultDir: DEFAULT_DIR,
  }),
  log_append: ({ entries: batch }: Record<string, unknown>) => {
    const list = batch as LogEntry[]
    entries = [...entries, ...list]
    return list.length
  },
  log_read: ({ limit, level }: Record<string, unknown>) => {
    const min = LEVELS.indexOf((level as LogLevel | null) ?? "info")
    return [...entries]
      .reverse()
      .filter((e) => LEVELS.indexOf(e.level) >= min)
      .slice(0, Number(limit))
  },
  log_purge: ({ cutoffMs }: Record<string, unknown>) => {
    entries = entries.filter((e) => e.ts >= Number(cutoffMs))
    return 0
  },
  log_reveal: null,
  log_pick_dir: PICKED_DIR,
  log_export: ({ fileName }: Record<string, unknown>) =>
    `/Users/demo/Downloads/${String(fileName)}`,
}
