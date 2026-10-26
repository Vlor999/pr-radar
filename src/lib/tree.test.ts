import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildTree,
  filterTree,
  isStacked,
  isStale,
  keepVanished,
  mergeState,
  sortTree,
} from "./tree.ts"
import type { Pr } from "./types.ts"

const pr = (
  number: number,
  head: string,
  base: string,
  extra: Partial<Pr> = {},
): Pr => ({
  id: `PR_${number}`,
  repo: "o/r",
  number,
  title: `PR ${number}`,
  url: "",
  head,
  base,
  draft: false,
  decision: null,
  conflicting: false,
  ci: null,
  comments: 0,
  unresolved: 0,
  threads: [],
  conversation: [],
  additions: 0,
  deletions: 0,
  files: 0,
  reviews: [],
  requested: [],
  updated: "2026-01-01T00:00:00Z",
  ...extra,
})

test("une PR stackée est rangée sous la PR dont elle part", () => {
  const [root] = buildTree([
    pr(1, "a", "main"),
    pr(2, "b", "a"),
    pr(3, "c", "b"),
  ])
  assert.equal(root.branch, "main")
  assert.deepEqual(
    root.children.map((n) => n.number),
    [1],
  )
  assert.deepEqual(
    root.children[0].children.map((n) => n.number),
    [2],
  )
  assert.equal(root.children[0].children[0].parent, 1)
  assert.deepEqual(
    root.children[0].children[0].children.map((n) => n.number),
    [3],
  )
})

test("une base sans PR à moi devient sa propre racine, après main", () => {
  const roots = buildTree([pr(1, "a", "feat/x"), pr(2, "b", "main")])
  assert.deepEqual(
    roots.map((r) => [r.branch, r.trunk]),
    [
      ["main", true],
      ["feat/x", false],
    ],
  )
})

test("le stack natif GitHub l'emporte sur les branches", () => {
  const stack = (position: number) => ({ number: 9, position, size: 2 })
  const [root] = buildTree([
    pr(1, "a", "main", { stack: stack(1) }),
    pr(2, "b", "main", { stack: stack(2) }),
  ])
  assert.deepEqual(
    root.children.map((n) => [n.number, n.children.map((c) => c.number)]),
    [[1, [2]]],
  )
  assert.equal(root.children[0].children[0].parent, 1)
})

test("le stack natif l'emporte sur une base qui pointe vers une autre PR", () => {
  const stack = (position: number) => ({ number: 9, position, size: 2 })
  const [root] = buildTree([
    pr(1, "a", "main", { stack: stack(1) }),
    pr(2, "b", "main"),
    pr(3, "c", "b", { stack: stack(2) }),
  ])
  const n1 = root.children.find((n) => n.number === 1)!
  const n2 = root.children.find((n) => n.number === 2)!
  assert.deepEqual(
    n1.children.map((c) => [c.number, c.parent]),
    [[3, 1]],
  )
  assert.deepEqual(n2.children, [])
})

test("une base qui pointe vers la PR au-dessus dans le stack natif ne fait pas de cycle", () => {
  const stack = (position: number) => ({ number: 9, position, size: 2 })
  const [root] = buildTree([
    pr(1, "q", "p", { stack: stack(1) }),
    pr(2, "p", "main", { stack: stack(2) }),
  ])
  assert.equal(root.branch, "p")
  assert.deepEqual(
    root.children.map((n) => [n.number, n.children.map((c) => c.number)]),
    [[1, [2]]],
  )
})

test("sans la PR d'en dessous du stack natif, les branches décident", () => {
  const [root] = buildTree([
    pr(1, "a", "main"),
    pr(2, "b", "a", { stack: { number: 9, position: 3, size: 3 } }),
  ])
  assert.equal(root.children[0].children[0].number, 2)
})

test("le bas d'un stack natif sur main compte comme stackée", () => {
  const stack = { number: 9, position: 1, size: 2 }
  assert.equal(isStacked(pr(1, "a", "main", { stack })), true)
  assert.equal(isStacked(pr(2, "b", "main")), false)
})

test("un stack natif d'une seule PR ne compte pas comme stackée", () => {
  const stack = { number: 9, position: 1, size: 1 }
  assert.equal(isStacked(pr(1, "a", "main", { stack })), false)
})

test("un cycle de branches ne boucle pas", () => {
  const roots = buildTree([pr(1, "a", "b"), pr(2, "b", "a")])
  assert.deepEqual(roots, [])
})

test("les changements demandés passent en premier", () => {
  const [root] = buildTree([
    pr(1, "a", "main"),
    pr(2, "b", "main", { decision: "CHANGES_REQUESTED" }),
  ])
  assert.deepEqual(
    root.children.map((n) => n.number),
    [2, 1],
  )
})

test("le filtre garde les ancêtres d'une PR qui matche", () => {
  const roots = buildTree([
    pr(1, "a", "main"),
    pr(2, "b", "a"),
    pr(3, "c", "main"),
  ])
  const [root] = filterTree(roots, (p) => p.number === 2)
  assert.deepEqual(
    root.children.map((n) => n.number),
    [1],
  )
  assert.deepEqual(
    root.children[0].children.map((n) => n.number),
    [2],
  )
  assert.deepEqual(
    filterTree(roots, () => false),
    [],
  )
})

test("prête à merger : approuvée, CI verte, sans conflit ni fil ouvert, à la base du stack", () => {
  const [root] = buildTree([
    pr(1, "a", "main", { decision: "APPROVED", ci: "SUCCESS" }),
    pr(2, "b", "a", { decision: "APPROVED", ci: "SUCCESS" }),
    pr(3, "c", "main", { decision: "APPROVED", ci: "FAILURE" }),
  ])
  const [one, three] = [
    root.children.find((n) => n.number === 1)!,
    root.children.find((n) => n.number === 3)!,
  ]
  assert.deepEqual(mergeState(one), { kind: "ready" })
  assert.deepEqual(mergeState(one.children[0]), { kind: "blocked", by: 1 })
  assert.equal(mergeState(three), null)
})

test("une PR est inactive après 5 jours sans activité", () => {
  const now = Date.parse("2026-01-10T00:00:00Z")
  assert.equal(
    isStale(pr(1, "a", "main", { updated: "2026-01-06T00:00:00Z" }), now),
    false,
  )
  assert.equal(
    isStale(pr(1, "a", "main", { updated: "2026-01-05T00:00:00Z" }), now),
    true,
  )
})

test("le tri s'applique à chaque niveau sans casser les stacks", () => {
  const roots = buildTree([
    pr(1, "a", "main"),
    pr(2, "b", "main"),
    pr(3, "c", "a"),
    pr(4, "d", "a"),
  ])
  const [root] = sortTree(roots, (x, y) => x.number - y.number)
  assert.deepEqual(
    root.children.map((n) => n.number),
    [1, 2],
  )
  assert.deepEqual(
    root.children[0].children.map((n) => n.number),
    [3, 4],
  )
})

test("repo vide d'un coup : ses PR sont gardées un cycle", () => {
  const before = [pr(1, "a", "main"), pr(2, "b", "main", { repo: "o/s" })]
  const res = keepVanished(before, [before[1]], new Set(), ["o/r", "o/s"])
  assert.deepEqual(
    res.prs.map((p) => p.number),
    [2, 1],
  )
  assert.deepEqual([...res.held], ["o/r"])
})

test("repo vide deux fois de suite : ses PR disparaissent", () => {
  const res = keepVanished([pr(1, "a", "main")], [], new Set(["o/r"]), ["o/r"])
  assert.deepEqual(res.prs, [])
  assert.equal(res.held.size, 0)
})

test("repo plus suivi : ses PR ne sont pas gardées", () => {
  const res = keepVanished([pr(1, "a", "main")], [], new Set(), [])
  assert.deepEqual(res.prs, [])
})
