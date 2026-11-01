import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { MCP_PROMPTS } from "./constants.ts"

test("MCP_PROMPTS suit les prompts déclarés par le shim (mcp-prompts.json, vérifié aussi par cargo test)", () => {
  const fixture: unknown = JSON.parse(
    readFileSync(new URL("./mcp-prompts.json", import.meta.url), "utf8"),
  )
  assert.deepEqual(
    MCP_PROMPTS.map(({ name, args }) => ({ name, args })),
    fixture,
  )
})
