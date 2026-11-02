import assert from "node:assert/strict"
import { test } from "node:test"

import {
  convCounts,
  filterConversations,
  withShown,
} from "./conversation-filter.ts"
import type { SlackConversation } from "./types.ts"

const conv = (extra: Partial<SlackConversation> = {}): SlackConversation => ({
  id: "C1",
  name: "dev",
  kind: "public",
  ...extra,
})

const DEV = conv()
const OPS = conv({ id: "G1", name: "ops-privé", kind: "private" })
const LEA = conv({
  id: "D1",
  name: "Léa Garcia",
  kind: "im",
  contact: { user: "U1", names: ["Léa Garcia", "Léa"], handle: "lea.garcia" },
})
const GROUP = conv({ id: "M1", name: "alice, bob", kind: "mpim" })
const ALL = [DEV, OPS, LEA, GROUP]

test("compteurs : cochées parmi la liste lue, channels publics et privés ensemble", () => {
  assert.deepEqual(convCounts(ALL, ["C1", "D1", "C9"]), {
    selected: 2,
    channel: 2,
    im: 1,
    mpim: 1,
  })
})

test("recherche sans casse ni accents, # et @ initiaux ignorés, identifiant du DM compris", () => {
  assert.deepEqual(filterConversations(ALL, "#DEV", "all", []), [DEV])
  assert.deepEqual(filterConversations(ALL, "ops-prive", "all", []), [OPS])
  assert.deepEqual(filterConversations(ALL, "@lea.g", "all", []), [LEA])
  assert.deepEqual(filterConversations(ALL, "zzz", "all", []), [])
})

test("filtres par type et cochées, dans l'ordre de la liste", () => {
  assert.deepEqual(filterConversations(ALL, "", "channel", []), [DEV, OPS])
  assert.deepEqual(filterConversations(ALL, "", "mpim", []), [GROUP])
  assert.deepEqual(filterConversations(ALL, "", "selected", ["M1", "C1"]), [
    DEV,
    GROUP,
  ])
})

test("cocher ou décocher les affichées garde les autres, sans doublon", () => {
  assert.deepEqual(withShown(["C1", "X"], [DEV, LEA], true), ["C1", "X", "D1"])
  assert.deepEqual(withShown(["C1", "X", "D1"], [DEV, LEA], false), ["X"])
})
