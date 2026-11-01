// Harnais (agent) derrière un appel MCP, déduit du `clientInfo.name` libre relayé par le shim.
import { HARNESS_PATTERNS } from "./constants.ts"
import type { McpClient } from "./mcp-data.ts"

export type Harness = Exclude<McpClient, "other">

/** Harnais connu d'après `clientInfo.name` (insensible à la casse) ; `null` si inconnu. */
export const harnessOf = (name: string): Harness | null =>
  HARNESS_PATTERNS.find(([, re]) => re.test(name))?.[0] ?? null
