import assert from "node:assert/strict"
import { test } from "node:test"

import { sweep, type Entry } from "./cache.ts"

const entry = (until: number): Entry<unknown> => ({
  until,
  value: Promise.resolve(null),
})

test("la purge retire les entrées expirées et garde les autres", () => {
  const m = new Map([
    ["merged:hier", entry(100)],
    ["prs:a", entry(200)],
    ["repos:all", entry(201)],
  ])
  sweep(m, 200)
  assert.deepEqual([...m.keys()], ["repos:all"])
})
