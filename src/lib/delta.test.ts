import assert from "node:assert/strict"
import { test } from "node:test"

import { FULL_REFRESH_MAX_AGE_MS } from "./constants.ts"
import {
  fingerprint,
  isFullRead,
  mergeProbe,
  splitProbe,
  type Known,
  type Snapshot,
} from "./delta.ts"

type P = { id: string; title: string }
const pr = (id: string, over: Partial<P> = {}): P => ({
  id,
  title: `PR ${id}`,
  ...over,
})
const node = (over: Record<string, unknown> = {}) => ({
  id: "a",
  updatedAt: "2026-11-01T10:00:00Z",
  mergeable: "MERGEABLE",
  commits: {
    nodes: [{ commit: { oid: "1", statusCheckRollup: { state: "PENDING" } } }],
  },
  ...over,
})
const known = (...xs: [string, string][]) =>
  new Map<string, Known<P>>(xs.map(([id, fp]) => [id, { fp, pr: pr(id) }]))
const snapshot = (fullAt: number): Snapshot<P> => ({
  fullAt,
  prs: known(["a", "1"]),
})

test("empreinte identique pour un même nœud", () => {
  assert.equal(fingerprint(node()), fingerprint(node()))
})

test("empreinte changée par la CI, sans changement de updatedAt", () => {
  const done = node({
    commits: {
      nodes: [
        { commit: { oid: "1", statusCheckRollup: { state: "SUCCESS" } } },
      ],
    },
  })
  assert.notEqual(fingerprint(done), fingerprint(node()))
})

test("empreinte changée par la mergeabilité", () => {
  assert.notEqual(
    fingerprint(node({ mergeable: "CONFLICTING" })),
    fingerprint(node()),
  )
})

test("lecture complète demandée : relue même avec un instantané récent", () => {
  assert.equal(isFullRead(snapshot(1_000), 1_000, true), true)
})

test("lot sans instantané (premier chargement, repos ou compte changés) : lecture complète", () => {
  assert.equal(isFullRead(undefined, 1_000, false), true)
})

test("instantané récent, actualisation automatique : par différence", () => {
  assert.equal(isFullRead(snapshot(0), FULL_REFRESH_MAX_AGE_MS, false), false)
})

test("dernière lecture complète trop ancienne : lecture complète", () => {
  assert.equal(
    isFullRead(snapshot(0), FULL_REFRESH_MAX_AGE_MS + 1, false),
    true,
  )
})

test("tri du sondage : nouvelle et changée relues, inchangée reprise", () => {
  const { changed, kept } = splitProbe(
    [
      { id: "a", fp: "1" },
      { id: "b", fp: "2-new" },
      { id: "c", fp: "3" },
    ],
    known(["a", "1"], ["b", "2"]),
  )
  assert.deepEqual(changed, ["b", "c"])
  assert.deepEqual([...kept.keys()], ["a"])
})

test("sans instantané précédent, tout est relu", () => {
  const { changed, kept } = splitProbe(
    [
      { id: "a", fp: "1" },
      { id: "b", fp: "2" },
    ],
    null,
  )
  assert.deepEqual(changed, ["a", "b"])
  assert.equal(kept.size, 0)
})

test("fusion : ordre du sondage, PR reprise réutilisée telle quelle, PR relue remplacée", () => {
  const old = pr("a")
  const { prs } = mergeProbe(
    [
      { id: "b", fp: "2" },
      { id: "a", fp: "1" },
    ],
    new Map([["a", old]]),
    new Map([["b", pr("b", { title: "nouveau" })]]),
    0,
  )
  assert.deepEqual(
    prs.map((p) => p.title),
    ["nouveau", "PR a"],
  )
  assert.equal(prs[1], old)
})

test("fusion : PR absente du sondage partie, PR introuvable à la relecture écartée", () => {
  const { prs, snapshot: next } = mergeProbe(
    [
      { id: "a", fp: "1" },
      { id: "gone", fp: "9" },
    ],
    new Map([
      ["a", pr("a")],
      ["closed", pr("closed")],
    ]),
    new Map(),
    0,
  )
  assert.deepEqual(
    prs.map((p) => p.id),
    ["a"],
  )
  assert.deepEqual([...next.prs.keys()], ["a"])
})

test("instantané suivant : nouvelles empreintes et date de relecture complète transmise", () => {
  const { snapshot: next } = mergeProbe(
    [{ id: "a", fp: "1-new" }],
    new Map(),
    new Map([["a", pr("a")]]),
    42,
  )
  assert.equal(next.fullAt, 42)
  assert.equal(next.prs.get("a")?.fp, "1-new")
})

test("lecture automatique après une lecture complète : rien de perdu, rien de relu", () => {
  const probe = [
    { id: "a", fp: "1" },
    { id: "b", fp: "2" },
  ]
  const first = mergeProbe(
    probe,
    new Map(),
    new Map([
      ["a", pr("a")],
      ["b", pr("b")],
    ]),
    0,
  )
  const { changed, kept } = splitProbe(probe, first.snapshot.prs)
  const second = mergeProbe(probe, kept, new Map(), first.snapshot.fullAt)
  assert.deepEqual(changed, [])
  assert.deepEqual(second.prs, first.prs)
})
