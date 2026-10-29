import assert from "node:assert/strict"
import { test } from "node:test"

import {
  applySnapshot,
  createSync,
  isSynced,
  snapshotOf,
  type Transport,
} from "./sync.ts"

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

test("le thème, la dernière notification et l'historique MCP restent propres à chaque fenêtre", () => {
  assert.equal(isSynced("pr-radar:theme"), false)
  assert.equal(isSynced("pr-radar:last-notification"), false)
  assert.equal(isSynced("pr-radar:mcp-history"), false)
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

/** Copie partagée de l'app, en mémoire ; `pull` peut être retenu ou échouer, `push` peut échouer. */
const app = (init: Record<string, string> = {}) => {
  const kv: Record<string, string> = { ...init }
  const pushes: Record<string, string | null>[] = []
  let failPush = 0
  let failPull = false
  let hold: Promise<void> | null = null
  const transport: Transport = {
    pull: async () => {
      const snap = { ...kv }
      if (hold) await hold
      if (failPull) throw new Error("503")
      return snap
    },
    push: async (entries) => {
      if (failPush-- > 0) throw new Error("offline")
      pushes.push(entries)
      for (const [k, v] of Object.entries(entries))
        if (v === null) delete kv[k]
        else kv[k] = v
    },
    seed: async () => {},
  }
  return {
    kv,
    pushes,
    transport,
    failNextPush: () => void (failPush = 1),
    failPulls: () => void (failPull = true),
    holdPull: () => {
      let release = () => {}
      hold = new Promise((r) => (release = r))
      return () => {
        hold = null
        release()
      }
    },
  }
}

test("une écriture faite pendant une relecture n'est pas écrasée par l'instantané", async () => {
  const s = storage({ "pr-radar:repos": "[]" })
  const a = app({ "pr-radar:repos": "[]" })
  const sync = createSync(() => s, a.transport)
  const release = a.holdPull()
  const pulled = sync.pull()
  sync.save("pr-radar:repos", '["a/b"]')
  release()
  await pulled
  await sync.idle()
  assert.equal(s.getItem("pr-radar:repos"), '["a/b"]')
  assert.equal(a.kv["pr-radar:repos"], '["a/b"]')
})

test("un envoi en échec reste en attente et part à la relecture suivante", async () => {
  const s = storage()
  const a = app()
  const sync = createSync(() => s, a.transport)
  a.failNextPush()
  sync.save("pr-radar:repos", '["a/b"]')
  await sync.idle()
  assert.equal(a.kv["pr-radar:repos"], undefined)
  await sync.pull()
  assert.equal(a.kv["pr-radar:repos"], '["a/b"]')
  assert.equal(s.getItem("pr-radar:repos"), '["a/b"]')
})

test("une relecture en échec ne touche pas au stockage", async () => {
  const s = storage({ "pr-radar:repos": "[]" })
  const a = app()
  a.failPulls()
  const sync = createSync(() => s, a.transport)
  await assert.rejects(sync.pull())
  assert.equal(s.getItem("pr-radar:repos"), "[]")
})

test("une écriture recalculée sur la valeur partagée garde le champ changé dans l'autre fenêtre", async () => {
  const s = storage({ "pr-radar:settings": '{"a":1,"b":1}' })
  const a = app({ "pr-radar:settings": '{"a":2,"b":1}' })
  const sync = createSync(() => s, a.transport)
  const changed: string[][] = []
  sync.onPulled((keys) => changed.push(keys))
  const patch = (raw: string | null) =>
    JSON.stringify({ ...(JSON.parse(raw ?? "{}") as object), b: 3 })
  sync.save("pr-radar:settings", '{"a":1,"b":3}', patch)
  await sync.idle()
  assert.equal(a.kv["pr-radar:settings"], '{"a":2,"b":3}')
  assert.equal(s.getItem("pr-radar:settings"), '{"a":2,"b":3}')
  assert.deepEqual(changed, [["pr-radar:settings"]])
})

test("une clé propre à la fenêtre n'est jamais envoyée", async () => {
  const s = storage()
  const a = app()
  const sync = createSync(() => s, a.transport)
  sync.save("pr-radar:theme", "dark")
  await sync.idle()
  assert.deepEqual(a.pushes, [])
  assert.equal(s.getItem("pr-radar:theme"), "dark")
})
