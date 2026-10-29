import assert from "node:assert/strict"
import { test } from "node:test"

import { applySnapshot, isSynced, snapshotOf } from "./sync.ts"

/** Stockage en mémoire, même interface que localStorage. */
const storage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return {
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    entries: () => Object.fromEntries(m),
  }
}

test("les réglages, comptes, repos et marques « vu » sont partagés", () => {
  for (const k of [
    "pr-radar:settings",
    "pr-radar:accounts",
    "pr-radar:repos",
    "pr-radar:slack",
    "pr-seen",
  ])
    assert.equal(isSynced(k), true, k)
})

test("le thème et la dernière notification restent propres à chaque fenêtre", () => {
  assert.equal(isSynced("pr-radar:theme"), false)
  assert.equal(isSynced("pr-radar:last-notification"), false)
})

test("une clé d'une autre application n'est pas partagée", () => {
  assert.equal(isSynced("other"), false)
})

test("l'instantané ne contient que les clés partagées", () => {
  const s = storage({
    "pr-radar:repos": "[]",
    "pr-radar:theme": "dark",
    other: "x",
  })
  assert.deepEqual(snapshotOf(s), { "pr-radar:repos": "[]" })
})

test("appliquer l'instantané écrit les valeurs reçues et renvoie les clés modifiées", () => {
  const s = storage({ "pr-radar:repos": "[]", "pr-seen": "{}" })
  const changed = applySnapshot(s, {
    "pr-radar:repos": '["a/b"]',
    "pr-seen": "{}",
  })
  assert.deepEqual(changed, ["pr-radar:repos"])
  assert.equal(s.getItem("pr-radar:repos"), '["a/b"]')
})

test("une clé partagée absente de l'instantané est effacée (déconnexion dans l'autre fenêtre)", () => {
  const s = storage({ "pr-radar:slack": '{"id":"T1"}' })
  assert.deepEqual(applySnapshot(s, {}), ["pr-radar:slack"])
  assert.equal(s.getItem("pr-radar:slack"), null)
})

test("le thème local n'est ni effacé ni écrasé par l'instantané", () => {
  const s = storage({ "pr-radar:theme": "dark" })
  applySnapshot(s, { "pr-radar:theme": "light" })
  assert.deepEqual(s.entries(), { "pr-radar:theme": "dark" })
})
