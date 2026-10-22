import assert from "node:assert/strict"
import { test } from "node:test"

import {
  filterReviews,
  groupByRepo,
  mergeReviews,
  newRequests,
  reviewCount,
  snapshot,
  toReview,
  type RawReview,
} from "./review.ts"
import type { ReviewPr } from "./types.ts"

const raw = (extra: Partial<RawReview> = {}): RawReview => ({
  number: 1,
  title: "PR",
  url: "",
  isDraft: false,
  createdAt: "2026-01-01T00:00:00Z",
  reviewDecision: "REVIEW_REQUIRED",
  author: { login: "alice" },
  repository: { nameWithOwner: "o/r" },
  viewerLatestReview: null,
  reviewRequests: { nodes: [] },
  timelineItems: { nodes: [] },
  ...extra,
})

const rv = (extra: Partial<ReviewPr> = {}): ReviewPr => ({
  repo: "o/r",
  number: 1,
  title: "PR",
  url: "",
  author: "alice",
  draft: false,
  decision: "REVIEW_REQUIRED",
  direct: true,
  teams: [],
  rerequest: false,
  since: "2026-01-01T00:00:00Z",
  ...extra,
})

const requested = (...r: { login?: string; name?: string }[]) => ({
  nodes: r.map((requestedReviewer) => ({ requestedReviewer })),
})

test("une demande à mon login est nominative", () => {
  const p = toReview(
    raw({ reviewRequests: requested({ login: "me" }, { name: "core" }) }),
    "me",
    "github",
  )
  assert.equal(p.direct, true)
  assert.deepEqual(p.teams, ["core"])
})

test("une demande seulement à une équipe n'est pas nominative", () => {
  const p = toReview(
    raw({ reviewRequests: requested({ login: "bob" }, { name: "core" }) }),
    "me",
    "github",
  )
  assert.equal(p.direct, false)
  assert.deepEqual(p.teams, ["core"])
})

test("une PR que j'ai déjà reviewée est une re-request", () => {
  const p = toReview(
    raw({ viewerLatestReview: { state: "COMMENTED" } }),
    "me",
    "github",
  )
  assert.equal(p.rerequest, true)
})

test("une review en cours (PENDING) ne fait pas une re-request", () => {
  const p = toReview(
    raw({ viewerLatestReview: { state: "PENDING" } }),
    "me",
    "github",
  )
  assert.equal(p.rerequest, false)
})

test("l'attente part de la dernière demande qui me vise", () => {
  const p = toReview(
    raw({
      reviewRequests: requested({ login: "me" }),
      timelineItems: {
        nodes: [
          {
            createdAt: "2026-01-02T00:00:00Z",
            requestedReviewer: { login: "me" },
          },
          {
            createdAt: "2026-01-05T00:00:00Z",
            requestedReviewer: { login: "me" },
          },
          {
            createdAt: "2026-01-09T00:00:00Z",
            requestedReviewer: { login: "bob" },
          },
        ],
      },
    }),
    "me",
    "github",
  )
  assert.equal(p.since, "2026-01-05T00:00:00Z")
})

test("sans événement de demande, l'attente part de la création de la PR", () => {
  assert.equal(toReview(raw(), "me", "github").since, "2026-01-01T00:00:00Z")
})

test("les chips Moi et Équipe séparent les demandes nominatives des demandes d'équipe", () => {
  const prs = [rv({ number: 1 }), rv({ number: 2, direct: false })]
  assert.deepEqual(
    filterReviews(prs, "me", false).map((p) => p.number),
    [1],
  )
  assert.deepEqual(
    filterReviews(prs, "team", false).map((p) => p.number),
    [2],
  )
  assert.equal(filterReviews(prs, "all", false).length, 2)
})

test("« Masquer déjà approuvées » ne cache que les demandes d'équipe approuvées", () => {
  const prs = [
    rv({ number: 1, decision: "APPROVED" }),
    rv({ number: 2, direct: false, decision: "APPROVED" }),
    rv({ number: 3, direct: false }),
  ]
  assert.deepEqual(
    filterReviews(prs, "all", true).map((p) => p.number),
    [1, 3],
  )
})

test("le compteur ne compte que les demandes nominatives hors drafts", () => {
  const prs = [rv(), rv({ draft: true }), rv({ direct: false })]
  assert.equal(reviewCount(prs), 1)
})

test("les groupes par repo commencent par la demande la plus ancienne", () => {
  const groups = groupByRepo([
    rv({ repo: "o/a", number: 1, since: "2026-01-05T00:00:00Z" }),
    rv({ repo: "o/b", number: 2, since: "2026-01-02T00:00:00Z" }),
    rv({ repo: "o/a", number: 3, since: "2026-01-01T00:00:00Z" }),
  ])
  assert.deepEqual(
    groups.map(([repo, prs]) => [repo, prs.map((p) => p.number)]),
    [
      ["o/a", [3, 1]],
      ["o/b", [2]],
    ],
  )
})

test("seules les nouvelles demandes nominatives sont signalées", () => {
  const before = snapshot({
    accounts: ["github"],
    reviews: [rv({ number: 1 })],
  })
  const prs = [
    rv({ number: 1 }),
    rv({ number: 2 }),
    rv({ number: 3, direct: false }),
  ]
  assert.deepEqual(
    newRequests(before, prs).map((p) => p.number),
    [2],
  )
})

test("une PR passée d'une demande d'équipe à une demande nominative est signalée", () => {
  const before = snapshot({
    accounts: ["github"],
    reviews: [rv({ direct: false })],
  })
  assert.equal(newRequests(before, [rv()]).length, 1)
})

test("l'arriéré d'un compte absent du chargement précédent n'est pas signalé", () => {
  const before = snapshot({ accounts: ["github"], reviews: [] })
  const prs = [rv({ repo: "work@ghe.example.com:o/r" })]
  assert.deepEqual(newRequests(before, prs), [])
})

test("un compte en échec garde ses PR précédentes", () => {
  const prev = {
    accounts: ["github", "w@ghe"],
    reviews: [rv({ number: 1 }), rv({ repo: "w@ghe:o/r", number: 2 })],
  }
  const next = mergeReviews(
    prev,
    [rv({ number: 3 })],
    ["github", "w@ghe"],
    ["w@ghe"],
  )
  assert.deepEqual(next.accounts, ["github", "w@ghe"])
  assert.deepEqual(
    next.reviews.map((p) => p.number),
    [3, 2],
  )
})

test("un compte en échec garde ses PR sans re-notification à son retour", () => {
  const prev = { accounts: ["w@ghe"], reviews: [rv({ repo: "w@ghe:o/r" })] }
  const kept = mergeReviews(prev, [], ["w@ghe"], ["w@ghe"])
  assert.deepEqual(newRequests(snapshot(kept), [rv({ repo: "w@ghe:o/r" })]), [])
})

test("un compte jamais lu avec succès reste inconnu", () => {
  const next = mergeReviews(
    { accounts: [], reviews: [] },
    [],
    ["w@ghe"],
    ["w@ghe"],
  )
  assert.deepEqual(next.accounts, [])
})
