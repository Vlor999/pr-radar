import assert from "node:assert/strict"
import { test } from "node:test"

import {
  isEventsFieldError,
  isStackFieldError,
  queryFor,
  timelineFields,
  toConversation,
  toPrEvents,
  withEventsFallback,
  withStackFallback,
} from "./pr-query.ts"

test("github.com demande les stacks natifs, pas un GitHub Enterprise", () => {
  assert.match(queryFor("github.com"), /stackEntry/)
  assert.doesNotMatch(queryFor("ghe.example.com"), /stackEntry/)
})

test("le marqueur STACK ne reste jamais dans la requête", () => {
  assert.doesNotMatch(queryFor("github.com"), /STACK\b/)
  assert.doesNotMatch(queryFor("github.com", true), /STACK\b/)
})

test("le sondage lit l'empreinte, pas les textes ; les deux requêtes suivent le repli des stacks", () => {
  assert.match(queryFor("github.com", false, "probe"), /search\(/)
  assert.doesNotMatch(queryFor("github.com", false, "probe"), /bodyHTML/)
  assert.match(queryFor("github.com", false, "nodes"), /nodes\(ids: \$ids\)/)
  assert.doesNotMatch(queryFor("github.com", true, "probe"), /stackEntry/)
})

test("un refus de stackEntry au sondage relance le sondage sans le champ", async () => {
  const queries: string[] = []
  await withStackFallback(
    "github.com",
    false,
    async (q) => {
      queries.push(q)
      if (q.includes("stackEntry")) throw FIELD_ERROR
    },
    () => {},
    "probe",
  )
  assert.equal(queries.length, 2)
  assert.ok(queries.every((q) => q.includes("search(")))
})

test("sans les stacks une fois le champ refusé", () => {
  assert.doesNotMatch(queryFor("github.com", true), /stackEntry/)
})

test("seule une erreur sur stackEntry déclenche le repli", () => {
  assert.equal(
    isStackFieldError(
      new Error("Field 'stackEntry' doesn't exist on type 'PullRequest'"),
    ),
    true,
  )
  assert.equal(isStackFieldError(new Error("Something went wrong")), false)
})

const FIELD_ERROR = new Error(
  "Field 'stackEntry' doesn't exist on type 'PullRequest'",
)

test("un refus de stackEntry relance une fois sans le champ", async () => {
  const queries: string[] = []
  let refused = false
  const out = await withStackFallback(
    "github.com",
    false,
    async (q) => {
      queries.push(q)
      if (q.includes("stackEntry")) throw FIELD_ERROR
      return "ok"
    },
    () => (refused = true),
  )
  assert.equal(out, "ok")
  assert.equal(refused, true)
  assert.deepEqual(
    queries.map((q) => q.includes("stackEntry")),
    [true, false],
  )
})

test("une autre erreur remonte sans relance", async () => {
  let calls = 0
  await assert.rejects(
    withStackFallback(
      "github.com",
      false,
      async () => {
        calls++
        throw new Error("Something went wrong")
      },
      () => {},
    ),
    /Something went wrong/,
  )
  assert.equal(calls, 1)
})

test("pas de relance quand le champ est déjà écarté", async () => {
  let calls = 0
  await assert.rejects(
    withStackFallback(
      "github.com",
      true,
      async () => {
        calls++
        throw FIELD_ERROR
      },
      () => {},
    ),
  )
  assert.equal(calls, 1)
})

test("conversation : commentaires et textes de review mêlés par date, review vide ou en cours ignorée", () => {
  const note = (login: string | null, bodyHTML: string, url: string) => ({
    author: login ? { login } : null,
    bodyHTML,
    url,
  })
  const notes = toConversation({
    conversation: {
      nodes: [
        {
          ...note("phc", "PR à reprendre", "c1"),
          createdAt: "2026-10-26T11:00:00Z",
        },
        { ...note(null, "fantôme", "c2"), createdAt: "2026-10-26T13:00:00Z" },
      ],
    },
    reviews: {
      nodes: [
        {
          ...note("bob", "Ok pour moi", "r1"),
          state: "APPROVED",
          submittedAt: "2026-10-26T12:00:00Z",
        },
        {
          ...note("bob", "", "r2"),
          state: "APPROVED",
          submittedAt: "2026-10-26T12:30:00Z",
        },
        {
          ...note("me", "brouillon", "r3"),
          state: "PENDING",
          submittedAt: null,
        },
      ],
    },
  })
  assert.deepEqual(
    notes.map((n) => [n.author, n.url, n.state]),
    [
      ["phc", "c1", undefined],
      ["bob", "r1", "APPROVED"],
      ["ghost", "c2", undefined],
    ],
  )
})

const review = (state: string, submittedAt: string | null, n = 0) => ({
  author: { login: "ada" },
  state,
  submittedAt,
  url: `r-${submittedAt}`,
  comments: { totalCount: n },
})

test("événements de la vue Fil : reviews envoyées et prête / fermeture / réouverture, par date", () => {
  const events = toPrEvents({
    reviews: {
      nodes: [
        review("APPROVED", "2026-01-04T00:00:00Z"),
        review("COMMENTED", "2026-01-02T00:00:00Z", 2),
      ],
    },
    events: {
      nodes: [
        {
          __typename: "ReadyForReviewEvent",
          actor: { login: "me" },
          createdAt: "2026-01-03T00:00:00Z",
        },
        null,
        {
          __typename: "ClosedEvent",
          actor: null,
          createdAt: "2026-01-05T00:00:00Z",
        },
      ],
    },
  })
  assert.deepEqual(events, [
    {
      kind: "review",
      who: "ada",
      at: "2026-01-02T00:00:00Z",
      review: "COMMENTED",
      threads: 2,
      url: "r-2026-01-02T00:00:00Z",
    },
    { kind: "ready", who: "me", at: "2026-01-03T00:00:00Z" },
    {
      kind: "review",
      who: "ada",
      at: "2026-01-04T00:00:00Z",
      review: "APPROVED",
      threads: 0,
      url: "r-2026-01-04T00:00:00Z",
    },
    { kind: "close", who: "ghost", at: "2026-01-05T00:00:00Z" },
  ])
})

test("une review en attente ou non envoyée n'est pas un événement de la vue Fil", () => {
  const events = toPrEvents({
    reviews: {
      nodes: [
        review("PENDING", "2026-01-02T00:00:00Z"),
        review("COMMENTED", null),
      ],
    },
    events: { nodes: [] },
  })
  assert.deepEqual(events, [])
})

test("les événements de la vue Fil sont lus avec chaque PR, sauf une fois refusés", () => {
  assert.match(queryFor("ghe.example.com"), /READY_FOR_REVIEW_EVENT/)
  assert.doesNotMatch(
    queryFor("ghe.example.com", false, "nodes", true),
    /timelineItems|EVENTS\b/,
  )
  assert.doesNotMatch(queryFor("github.com", false, "probe"), /timelineItems/)
})

const EVENTS_ERROR = new Error(
  "Argument 'itemTypes' on Field 'timelineItems' has an invalid value",
)

test("seule une erreur sur les événements de la vue Fil déclenche leur repli", () => {
  for (const message of [
    "Argument 'itemTypes' on Field 'timelineItems' has an invalid value ([READY_FOR_REVIEW_EVENT]). Expected type '[PullRequestTimelineItemsItemType!]'.",
    "Field 'timelineItems' doesn't exist on type 'PullRequest'",
    "Field 'timelineItems' doesn't accept argument 'itemTypes'",
    "No such type ReadyForReviewEvent, so it can't be a fragment condition",
    "Fragment on ReopenedEvent can't be spread inside PullRequestTimelineItems",
  ])
    assert.equal(isEventsFieldError(new Error(message)), true, message)
  assert.equal(isEventsFieldError(FIELD_ERROR), false)
  assert.equal(isEventsFieldError(new Error("Something went wrong")), false)
})

test("un refus des événements relance une fois sans eux et le retient", async () => {
  const calls: boolean[] = []
  let refused = false
  const out = await withEventsFallback(
    false,
    async (without) => {
      calls.push(without)
      if (!without) throw EVENTS_ERROR
      return "ok"
    },
    () => (refused = true),
  )
  assert.equal(out, "ok")
  assert.equal(refused, true)
  assert.deepEqual(calls, [false, true])
})

test("une autre erreur n'est pas rattrapée par le repli des événements", async () => {
  await assert.rejects(
    withEventsFallback(
      false,
      async () => {
        throw new Error("HTTP 502")
      },
      () => assert.fail("pas de repli"),
    ),
    /HTTP 502/,
  )
})

test("événements déjà refusés : lecture directe sans eux", async () => {
  const calls: boolean[] = []
  await withEventsFallback(
    true,
    async (w) => calls.push(w),
    () => {},
  )
  assert.deepEqual(calls, [true])
})

test("champs de la vue Fil d'une PR : ouverture, auteur, robot et événements", () => {
  const fields = timelineFields({
    createdAt: "2026-01-01T00:00:00Z",
    author: { login: "renovate", __typename: "Bot" },
    reviews: { nodes: [review("APPROVED", "2026-01-02T00:00:00Z")] },
    events: { nodes: [] },
  })
  assert.deepEqual(fields, {
    createdAt: "2026-01-01T00:00:00Z",
    author: "renovate",
    bot: true,
    events: [
      {
        kind: "review",
        who: "ada",
        at: "2026-01-02T00:00:00Z",
        review: "APPROVED",
        threads: 0,
        url: "r-2026-01-02T00:00:00Z",
      },
    ],
  })
})

test("PR sans auteur ni événements lus (champ refusé) : ghost, pas robot, reviews gardées", () => {
  const fields = timelineFields({
    createdAt: "2026-01-01T00:00:00Z",
    author: null,
    reviews: { nodes: [review("COMMENTED", "2026-01-02T00:00:00Z")] },
  })
  assert.equal(fields.author, "ghost")
  assert.equal("bot" in fields, false)
  assert.deepEqual(
    fields.events.map((e) => e.kind),
    ["review"],
  )
})

test("une erreur qui nomme timelineItems sans être un refus du schéma ne déclenche pas le repli", () => {
  assert.equal(
    isEventsFieldError(
      new Error("Timeout on validation of query: timelineItems took too long"),
    ),
    false,
  )
  assert.equal(
    isEventsFieldError(
      new Error(
        "Something went wrong while executing your query (ReadyForReviewEvent)",
      ),
    ),
    false,
  )
})
