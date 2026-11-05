import assert from "node:assert/strict"
import { test } from "node:test"

import {
  clip,
  exceptMineFor,
  isBot,
  layoutRow,
  mergeTimeline,
  searchBounds,
  storeTimelineMemo,
  timelineSearches,
  toRows,
  toTimelinePr,
  windowOf,
  withSlack,
  type RawTimelineItem,
  type RawTimelinePr,
  type TimelineWindow,
} from "./timeline.ts"
import type { Pr, SlackMention, TimelineEvent, TimelinePr } from "./types.ts"

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

test("une review lue légère garde son état, son auteur et ses commentaires de code, sans texte", () => {
  const p = toTimelinePr(
    raw([
      {
        __typename: "PullRequestReview",
        author: { login: "ada" },
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-01-02T10:00:00Z",
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

/* ---------- PR de l'arbre ---------- */

const open = (extra: Partial<Pr> = {}): Pr => ({
  id: "PR_1",
  repo: "o/r",
  number: 1,
  title: "PR 1",
  url: "https://github.com/o/r/pull/1",
  head: "feat/1",
  base: "main",
  draft: false,
  decision: null,
  conflicting: false,
  canUpdateBranch: false,
  sha: null,
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
  updated: "2026-01-05T00:00:00Z",
  createdAt: "2026-01-01T10:00:00Z",
  author: "me",
  events: [],
  ...extra,
})
const stripTags = (html: string) => html.replace(/<[^>]+>/g, "")
const fromTree = (p: Pr) => storeTimelineMemo(stripTags)([p])[0]

test("une PR de l'arbre commence à son ouverture, par son auteur", () => {
  const p = fromTree(
    open({ author: "ada", involved: { reason: "assigned", author: "ada" } }),
  )
  assert.deepEqual(p.events, [
    { kind: "start", at: "2026-01-01T10:00:00Z", who: "ada" },
  ])
  assert.equal(p.mine, false)
  assert.equal(p.state, "OPEN")
})

test("une review de l'arbre reprend son texte de la conversation, en texte brut", () => {
  const url = "https://github.com/o/r/pull/1#pullrequestreview-1"
  const p = fromTree(
    open({
      events: [
        {
          kind: "review",
          who: "ada",
          at: D(2),
          review: "CHANGES_REQUESTED",
          threads: 3,
          url,
        },
      ],
      conversation: [
        {
          author: "ada",
          body: "<p>Voir le <code>31</code></p>",
          url,
          at: D(2),
          state: "CHANGES_REQUESTED",
        },
      ],
    }),
  )
  assert.deepEqual(p.events[1], {
    kind: "review",
    at: D(2),
    who: "ada",
    review: "CHANGES_REQUESTED",
    threads: 3,
    text: "Voir le 31",
  })
})

test("une review de l'arbre sans texte reste un événement, sans texte", () => {
  const p = fromTree(
    open({
      events: [
        {
          kind: "review",
          who: "ada",
          at: D(2),
          review: "APPROVED",
          threads: 0,
          url: "u",
        },
      ],
    }),
  )
  assert.equal(p.events[1].review, "APPROVED")
  assert.equal("text" in p.events[1], false)
})

test("les commentaires généraux de l'arbre sont des commentaires, pas les textes de review", () => {
  const p = fromTree(
    open({
      conversation: [
        { author: "bob", body: "<p>Ok</p>", url: "c1", at: D(3) },
        {
          author: "ada",
          body: "<p>LGTM</p>",
          url: "r1",
          at: D(4),
          state: "APPROVED",
        },
      ],
    }),
  )
  assert.deepEqual(
    p.events.map((e) => [e.kind, e.who, e.text]),
    [
      ["start", "me", undefined],
      ["comment", "bob", "Ok"],
    ],
  )
})

test("le texte d'un commentaire de l'arbre est coupé", () => {
  const p = fromTree(
    open({
      conversation: [
        { author: "bob", body: "x".repeat(5_000), url: "c1", at: D(3) },
      ],
    }),
  )
  assert.equal(p.events[1].text, clip("x".repeat(5_000)))
  assert.ok(p.events[1].text!.length < 1_000)
})

test("prête, fermeture et réouverture de l'arbre s'insèrent dans le fil par date", () => {
  const p = fromTree(
    open({
      draft: false,
      events: [
        { kind: "ready", who: "me", at: D(2) },
        { kind: "close", who: "me", at: D(3) },
        { kind: "reopen", who: "me", at: D(4) },
      ],
    }),
  )
  assert.deepEqual(
    p.events.map((e) => e.kind),
    ["start", "ready", "close", "reopen"],
  )
})

test("une PR de l'arbre d'un robot n'est pas dans le fil", () => {
  assert.deepEqual(storeTimelineMemo(stripTags)([open({ bot: true })]), [])
})

test("une PR de l'arbre remplace celle de la lecture légère, les autres sont gardées", () => {
  const tree = pr([{ kind: "start", at: D(1), text: "arbre" }])
  const light = [
    pr([{ kind: "start", at: D(1) }]),
    pr([{ kind: "start", at: D(2) }], { number: 2 }),
  ]
  const out = mergeTimeline([tree], light)
  assert.deepEqual(
    out.map((p) => [p.number, p.events[0].text]),
    [
      [1, "arbre"],
      [2, undefined],
    ],
  )
})

test("même numéro dans deux repos : pas un doublon", () => {
  const out = mergeTimeline(
    [pr([{ kind: "start", at: D(1) }])],
    [pr([{ kind: "start", at: D(1) }], { repo: "o/autre" })],
  )
  assert.equal(out.length, 2)
})

/* ---------- Recherches légères ---------- */

test("fenêtre d'aujourd'hui, arbre complet : mes PR ouvertes ne sont pas cherchées", () => {
  assert.equal(exceptMineFor("2026-01-10", "2026-01-10", true), true)
  assert.match(
    timelineSearches(
      { from: "2026-01-01", to: "2026-01-11" },
      "repo:o/r",
      true,
    )[0],
    /^is:pr is:open -author:@me created:<=2026-01-11 repo:o\/r$/,
  )
})

test("fenêtre passée : tout est cherché, l'arbre n'a que l'état actuel", () => {
  assert.equal(exceptMineFor("2026-01-09", "2026-01-10", true), false)
  assert.deepEqual(
    timelineSearches(
      { from: "2026-01-01", to: "2026-01-10" },
      "repo:o/r",
      false,
    ),
    [
      "is:pr is:open created:<=2026-01-10 repo:o/r",
      "is:pr is:closed closed:>=2026-01-01 created:<=2026-01-10 repo:o/r",
    ],
  )
})

test("arbre pas encore chargé ou en erreur : tout est cherché", () => {
  assert.equal(exceptMineFor("2026-01-10", "2026-01-10", false), false)
})

test("les PR fermées sont cherchées même quand mes PR ouvertes viennent de l'arbre", () => {
  assert.equal(
    timelineSearches(
      { from: "2026-01-01", to: "2026-01-11" },
      "repo:o/r",
      true,
    )[1],
    "is:pr is:closed closed:>=2026-01-01 created:<=2026-01-11 repo:o/r",
  )
})

test("fenêtre qui finit après aujourd'hui, arbre complet : mes PR ouvertes viennent de l'arbre", () => {
  assert.equal(exceptMineFor("2026-01-12", "2026-01-10", true), true)
})

test("PR de l'arbre mergée depuis la dernière actualisation : état et merge de la lecture légère, textes de l'arbre", () => {
  const tree = pr([
    { kind: "start", at: D(1) },
    { kind: "comment", at: D(2), who: "ada", text: "Ok" },
  ])
  const light = pr(
    [
      { kind: "start", at: D(1) },
      { kind: "comment", at: D(2), who: "ada" },
      { kind: "merge", at: D(3), who: "me" },
    ],
    { state: "MERGED" },
  )
  const [p] = mergeTimeline([tree], [light])
  assert.equal(p.state, "MERGED")
  assert.deepEqual(
    p.events.map((e) => [e.kind, e.text]),
    [
      ["start", undefined],
      ["comment", "Ok"],
      ["merge", undefined],
    ],
  )
  assert.equal(row(p).status, "merged")
})

test("PR de l'arbre fermée puis rouverte puis fermée : seule la nouvelle fermeture est ajoutée", () => {
  const tree = pr([
    { kind: "start", at: D(1) },
    { kind: "close", at: D(2) },
    { kind: "reopen", at: D(3) },
  ])
  const light = pr(
    [
      { kind: "start", at: D(1) },
      { kind: "close", at: D(2) },
      { kind: "reopen", at: D(3) },
      { kind: "close", at: D(4) },
    ],
    { state: "CLOSED" },
  )
  const [p] = mergeTimeline([tree], [light])
  assert.deepEqual(
    p.events.map((e) => e.kind),
    ["start", "close", "reopen", "close"],
  )
  assert.equal(p.state, "CLOSED")
})

test("une PR de l'arbre inchangée n'est pas reconvertie, une PR modifiée l'est", () => {
  let parsed = 0
  const toStore = storeTimelineMemo((h) => (parsed++, stripTags(h)))
  const a = open({
    conversation: [{ author: "bob", body: "<p>Ok</p>", url: "c1", at: D(3) }],
  })
  const first = toStore([a])
  const again = toStore([{ ...a }])
  assert.equal(again[0], first[0])
  assert.equal(parsed, 1)
  const changed = toStore([{ ...a, updated: "2026-01-06T00:00:00Z" }])
  assert.notEqual(changed[0], first[0])
  assert.equal(parsed, 2)
})

test("une PR sortie de l'arbre quitte le fil converti, un robot n'y entre pas", () => {
  const toStore = storeTimelineMemo(stripTags)
  toStore([open()])
  assert.deepEqual(toStore([open({ number: 2, url: "u2", bot: true })]), [])
})

test("PR ouverte dans les deux sources : les événements anciens de la lecture légère s'ajoutent à l'arbre, sans doublon", () => {
  const tree = pr([
    { kind: "start", at: D(1), who: "me" },
    { kind: "review", at: D(5), who: "ada", review: "APPROVED", text: "LGTM" },
    { kind: "comment", at: D(6), who: "bob", text: "Ok" },
  ])
  const light = pr([
    { kind: "start", at: D(1), who: "me" },
    { kind: "comment", at: D(2), who: "bob" },
    { kind: "review", at: D(3), who: "ada", review: "CHANGES_REQUESTED" },
    { kind: "ready", at: D(4) },
    { kind: "review", at: D(5), who: "ada", review: "APPROVED" },
    { kind: "comment", at: D(6), who: "bob" },
  ])
  const [p] = mergeTimeline([tree], [light])
  assert.equal(p.state, "OPEN")
  assert.deepEqual(
    p.events.map((e) => [e.kind, e.at, e.text]),
    [
      ["start", D(1), undefined],
      ["comment", D(2), undefined],
      ["review", D(3), undefined],
      ["ready", D(4), undefined],
      ["review", D(5), "LGTM"],
      ["comment", D(6), "Ok"],
    ],
  )
})
