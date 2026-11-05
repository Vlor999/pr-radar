import assert from "node:assert/strict"
import { test } from "node:test"

import {
  clip,
  isBot,
  layoutRow,
  searchBounds,
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
        bodyText: "",
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
        bodyText: "Voir le cas du 31",
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

const mergeAndClose = (closeOffsetMs: number) =>
  toTimelinePr(
    raw(
      [
        {
          __typename: "MergedEvent",
          actor: { login: "me" },
          createdAt: "2026-01-02T10:00:00.000Z",
        },
        {
          __typename: "ClosedEvent",
          actor: { login: "me" },
          createdAt: new Date(
            Date.parse("2026-01-02T10:00:00.000Z") + closeOffsetMs,
          ).toISOString(),
        },
      ],
      { state: "MERGED", mergedAt: "2026-01-02T10:00:00.000Z" },
    ),
    "o/r",
    "me",
  ).events.map((e) => e.kind)

test("une fermeture à moins de 5 s du merge est ignorée", () => {
  assert.deepEqual(mergeAndClose(4_999), ["start", "merge"])
})

test("une fermeture à 5 s du merge ou plus est gardée", () => {
  assert.deepEqual(mergeAndClose(5_000), ["start", "merge", "close"])
})

test("une PR sans auteur (compte supprimé) est à ghost", () => {
  const p = toTimelinePr(raw([], { author: null }), "o/r", "me")
  assert.equal(p.author, "ghost")
  assert.equal(p.events[0].who, "ghost")
  assert.equal(p.mine, false)
})

test("le texte d'un commentaire est coupé à la lecture", () => {
  const p = toTimelinePr(
    raw([
      {
        __typename: "IssueComment",
        author: { login: "ada" },
        createdAt: D(2),
        bodyText: "x".repeat(5_000),
      },
    ]),
    "o/r",
    "me",
  )
  assert.equal(p.events[1].text, clip("x".repeat(5_000)))
  assert.ok(p.events[1].text!.length < 1_000)
})

test("les bornes de recherche ont un jour de marge de chaque côté", () => {
  assert.deepEqual(searchBounds("2026-03-01", "2026-12-31"), {
    from: "2026-02-28",
    to: "2027-01-01",
  })
})

test("une PR passée en revue dont le « prête » n'est pas lu n'a pas de tronçon brouillon", () => {
  const l = layoutRow(row(pr([{ kind: "start", at: D(3) }])), W, WIDTH)
  assert.ok(l.segments.every((s) => s.kind !== "draft"))
})

test("une PR remise en brouillon après un « prête » reste en pointillés jusqu'au bout", () => {
  const p = pr(
    [
      { kind: "start", at: D(2) },
      { kind: "ready", at: D(4) },
    ],
    { draft: true },
  )
  const draft = layoutRow(row(p), W, WIDTH).segments.find(
    (s) => s.kind === "draft",
  )
  assert.ok(draft && Math.round(draft.to) === 900)
})
