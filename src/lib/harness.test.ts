import assert from "node:assert/strict"
import { test } from "node:test"

import { harnessOf } from "./harness.ts"

test("reconnaît le clientInfo.name envoyé par chaque harnais", () => {
  const cases: [string, ReturnType<typeof harnessOf>][] = [
    ["claude-code", "claude-code"],
    ["claude-ai", "claude-desktop"],
    ["cursor-vscode", "cursor"],
    ["Visual Studio Code", "vscode"],
    ["Visual Studio Code - Insiders", "vscode"],
    ["Code - OSS", "vscode"],
    ["codex-mcp-client", "codex"],
    ["gemini-cli-mcp-client", "gemini"],
    ["Zed", "zed"],
    ["windsurf-client", "windsurf"],
    ["antigravity-client", "antigravity"],
    ["devin", "devin"],
  ]
  for (const [name, harness] of cases)
    assert.equal(harnessOf(name), harness, name)
})

test("ignore la casse", () => {
  assert.equal(harnessOf("CLAUDE-CODE"), "claude-code")
  assert.equal(harnessOf("Cursor"), "cursor")
})

test("garde le harnais derrière un proxy qui suffixe le nom", () => {
  assert.equal(harnessOf("claude-ai (via mcp-remote 0.1.9)"), "claude-desktop")
  assert.equal(harnessOf("cursor-vscode (via mcp-remote 0.1.18)"), "cursor")
})

test("ne confond pas un mot qui contient le nom d'un harnais", () => {
  assert.equal(harnessOf("authorized-client"), null)
  assert.equal(harnessOf("devinette"), null)
})

test("client inconnu → null", () => {
  assert.equal(harnessOf("my-agent"), null)
  assert.equal(harnessOf(""), null)
})
