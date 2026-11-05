import assert from "node:assert/strict"
import { test } from "node:test"

import {
  isBot,
  layoutRow,
  toRows,
  toTimelinePr,
  windowOf,
  withSlack,
  type RawTimelineItem,
  type RawTimelinePr,
  type TimelineWindow,
} from "./timeline.ts"
import type { SlackMention, TimelineEvent, TimelinePr } from "./types.ts"

const raw = (
  nodes: RawTimelineItem[],
  extra: Partial<RawTimelinePr> = {},
): RawTimelinePr => ({
  number: 1,
  title: "PR 1",
  url: "https://github.com/o/r/pull/1",
  state: "OPEN",
  isDraft: false,
  createdAt: "2026-01-01T10:00:00Z",
  mergedAt: null,
  closedAt: null,
  author: { login: "me", __typename: "User" },
  repository: { nameWithOwner: "o/r" },
  timelineItems: { nodes },
  ...extra,
})

const D = (day: number, h = 12) => new Date(2026, 0, day, h).toISOString()

const pr = (
  events: TimelineEvent[],
  extra: Partial<TimelinePr> = {},
): TimelinePr => ({
  repo: "o/r",
  number: 1,
  title: "PR 1",
  url: "",
  state: "OPEN",
  draft: false,
  author: "me",
  mine: true,
  createdAt: events[0].at,
  events,
  ...extra,
})

// fenêtre du 1er au 10 janvier 2026, maintenant : le 10 à midi ; 10 jours × 100 px
const W: TimelineWindow = windowOf(
  new Date(2026, 0, 10),
  10,
  new Date(2026, 0, 10, 12).getTime(),
)
const WIDTH = 1000
const row = (p: TimelinePr) => toRows([p], W)[0]

test("la fermeture qui accompagne le merge n'est pas un événement", () => {
  const p = toTimelinePr(
    raw(
      [
        {
          __typename: "MergedEvent",
          actor: { login: "me" },
          createdAt: "2026-01-02T10:00:00Z",
        },
        {
          __typename: "ClosedEvent",
          actor: { login: "me" },
          createdAt: "2026-01-02T10:00:01Z",
        },
      ],
      { state: "MERGED", mergedAt: "2026-01-02T10:00:00Z" },
    ),
    "o/r",
    "me",
  )
  assert.deepEqual(
    p.events.map((e) => e.kind),
    ["start", "merge"],
  )
})

test("une review en attente n'est pas un événement", () => {
  const p = toTimelinePr(
    raw([
      {
        __typename: "PullRequestReview",
        author: { login: "ada" },
        state: "PENDING",
        submittedAt: null,
        body: "",
        comments: { totalCount: 0 },
      },
    ]),
    "o/r",
    "me",
  )
  assert.deepEqual(
    p.events.map((e) => e.kind),
    ["start"],
  )
})

test("une review garde son état, son auteur et ses commentaires de code", () => {
  const p = toTimelinePr(
    raw([
      {
        __typename: "PullRequestReview",
        author: { login: "ada" },
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-01-02T10:00:00Z",
        body: "Voir le cas du 31",
        comments: { totalCount: 4 },
      },
    ]),
    "o/r",
    "me",
  )
  assert.deepEqual(p.events[1], {
    kind: "review",
    at: "2026-01-02T10:00:00Z",
    who: "ada",
    text: "Voir le cas du 31",
    review: "CHANGES_REQUESTED",
    threads: 4,
  })
})

test("une PR mergée sans MergedEvent lu prend sa date de merge", () => {
  const p = toTimelinePr(
    raw([], { state: "MERGED", mergedAt: "2026-01-03T10:00:00Z" }),
    "o/r",
    "me",
  )
  assert.deepEqual(p.events.at(-1), {
    kind: "merge",
    at: "2026-01-03T10:00:00Z",
  })
})

test("une PR d'un autre n'est pas à moi", () => {
  const p = toTimelinePr(raw([], { author: { login: "ada" } }), "o/r", "me")
  assert.equal(p.mine, false)
})

test("un auteur de type Bot ou au login [bot] est un robot", () => {
  assert.equal(isBot({ login: "renovate", __typename: "Bot" }), true)
  assert.equal(isBot({ login: "dependabot[bot]" }), true)
  assert.equal(isBot({ login: "ada", __typename: "User" }), false)
})

test("les mentions Slack s'insèrent dans le fil par date", () => {
  const m: SlackMention = {
    author: "me",
    channelId: "C1",
    where: "#web",
    at: D(2),
    text: "à relire",
    permalink: "https://x.slack.com/p1",
  }
  const p = withSlack(
    pr([
      { kind: "start", at: D(1) },
      { kind: "comment", at: D(3) },
    ]),
    [m],
  )
  assert.deepEqual(
    p.events.map((e) => e.kind),
    ["start", "slack", "comment"],
  )
  assert.equal(p.events[1].permalink, "https://x.slack.com/p1")
})

test("une PR finie avant la fenêtre n'est pas affichée", () => {
  const p = pr(
    [
      { kind: "start", at: "2025-12-01T10:00:00Z" },
      { kind: "merge", at: "2025-12-02T10:00:00Z" },
    ],
    {
      state: "MERGED",
    },
  )
  assert.equal(toRows([p], W).length, 0)
})

test("une PR ouverte avant la fenêtre et toujours ouverte est affichée", () => {
  const p = pr([{ kind: "start", at: "2025-11-01T10:00:00Z" }])
  assert.equal(toRows([p], W).length, 1)
})

test("les PR en cours passent avant les terminées, chaque groupe par activité récente", () => {
  const done = pr(
    [
      { kind: "start", at: D(2) },
      { kind: "merge", at: D(5) },
    ],
    { number: 2, state: "MERGED" },
  )
  const old = pr(
    [
      { kind: "start", at: D(1) },
      { kind: "comment", at: D(2) },
    ],
    { number: 3 },
  )
  const fresh = pr(
    [
      { kind: "start", at: D(1) },
      { kind: "comment", at: D(8) },
    ],
    { number: 4 },
  )
  assert.deepEqual(
    toRows([done, old, fresh], W).map((r) => r.number),
    [4, 3, 2],
  )
})

test("l'état d'une PR fermée sans merge est « closed »", () => {
  const p = pr(
    [
      { kind: "start", at: D(2) },
      { kind: "close", at: D(4) },
    ],
    { state: "CLOSED" },
  )
  assert.equal(row(p).status, "closed")
})

test("une PR ouverte avant la fenêtre a un fil en fondu à gauche", () => {
  const l = layoutRow(
    row(pr([{ kind: "start", at: "2025-12-20T10:00:00Z" }])),
    W,
    WIDTH,
  )
  assert.deepEqual(l.segments[0], { from: 0, to: 24, kind: "fade" })
})

test("un brouillon jamais passé en revue a un fil en pointillés", () => {
  const l = layoutRow(
    row(pr([{ kind: "start", at: D(3) }], { draft: true })),
    W,
    WIDTH,
  )
  assert.ok(l.segments.some((s) => s.kind === "draft"))
})

test("entre une fermeture et une réouverture, le fil est en pointillés rouges", () => {
  const p = pr(
    [
      { kind: "start", at: D(1) },
      { kind: "close", at: D(3) },
      { kind: "reopen", at: D(5) },
      { kind: "merge", at: D(7) },
    ],
    { state: "MERGED" },
  )
  const gap = layoutRow(row(p), W, WIDTH).segments.find((s) => s.kind === "gap")
  assert.ok(gap && Math.round(gap.from) === 250 && Math.round(gap.to) === 450)
})

test("une fermeture suivie d'une réouverture n'est pas la fin du fil", () => {
  const p = pr(
    [
      { kind: "start", at: D(1) },
      { kind: "close", at: D(3) },
      { kind: "reopen", at: D(5) },
      { kind: "merge", at: D(7) },
    ],
    { state: "MERGED" },
  )
  const anchors = layoutRow(row(p), W, WIDTH).markers.filter(
    (m) => m.type === "anchor",
  )
  assert.deepEqual(
    anchors.map((m) => m.lead.kind),
    ["start", "merge"],
  )
})

test("une PR ouverte a une zone en attente sur aujourd'hui", () => {
  const l = layoutRow(row(pr([{ kind: "start", at: D(3) }])), W, WIDTH)
  assert.deepEqual(l.pending, { from: 902, to: 998 })
})

test("une PR mergée n'a pas de zone en attente", () => {
  const p = pr(
    [
      { kind: "start", at: D(3) },
      { kind: "merge", at: D(4) },
    ],
    { state: "MERGED" },
  )
  assert.equal(layoutRow(row(p), W, WIDTH).pending, null)
})

test("des événements proches forment un seul groupe", () => {
  const burst = Array.from({ length: 12 }, (_, i): TimelineEvent => ({
    kind: "comment",
    at: new Date(2026, 0, 5, 8, i * 5).toISOString(),
  }))
  const l = layoutRow(
    row(pr([{ kind: "start", at: D(1) }, ...burst])),
    W,
    WIDTH,
  )
  const cluster = l.markers.filter((m) => m.type === "cluster")
  assert.equal(cluster.length, 1)
  assert.equal(cluster[0].items.length, 12)
})

test("des événements éloignés restent séparés", () => {
  const l = layoutRow(
    row(
      pr([
        { kind: "start", at: D(1) },
        { kind: "comment", at: D(3) },
        { kind: "comment", at: D(6) },
      ]),
    ),
    W,
    WIDTH,
  )
  assert.equal(l.markers.filter((m) => m.type === "single").length, 2)
})

test("un événement qui touche le merge est absorbé par lui", () => {
  const p = pr(
    [
      { kind: "start", at: D(1) },
      {
        kind: "review",
        review: "APPROVED",
        at: new Date(2026, 0, 6, 11).toISOString(),
      },
      { kind: "merge", at: D(6) },
    ],
    { state: "MERGED" },
  )
  const l = layoutRow(row(p), W, WIDTH)
  assert.equal(l.markers.length, 2)
  assert.deepEqual(
    l.markers[1].items.map((e) => e.kind),
    ["review", "merge"],
  )
})

test("une PR ouverte et mergée le même jour garde un bout de fil visible", () => {
  const p = pr(
    [
      { kind: "start", at: new Date(2026, 0, 5, 9).toISOString() },
      { kind: "merge", at: new Date(2026, 0, 5, 10).toISOString() },
    ],
    { state: "MERGED" },
  )
  const [start, end] = layoutRow(row(p), W, WIDTH).markers
  assert.ok(end.x - start.x >= 24)
})

test("le passage en « prête » n'a pas de marqueur", () => {
  const p = pr([
    { kind: "start", at: D(1) },
    { kind: "ready", at: D(4) },
  ])
  const l = layoutRow(row(p), W, WIDTH)
  assert.ok(l.markers.every((m) => m.lead.kind !== "ready"))
})
