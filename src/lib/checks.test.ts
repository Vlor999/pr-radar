import assert from "node:assert/strict"
import { test } from "node:test"

import {
  canRerun,
  contextState,
  formatDuration,
  jobDurationMs,
  rerunError,
  runState,
  toCiView,
  type RawChecks,
} from "./checks.ts"
import type { CiJob, CiWorkflow } from "./types.ts"

type Suite = NonNullable<
  NonNullable<RawChecks["repository"]>["pullRequest"]
>["commits"]["nodes"][number]["commit"]

const raw = (commit: Partial<Suite>): RawChecks => ({
  repository: {
    pullRequest: {
      commits: {
        nodes: [{ commit: { checkSuites: null, status: null, ...commit } }],
      },
    },
  },
})

const run = (name: string, status = "COMPLETED", conclusion = "SUCCESS") => ({
  name,
  status,
  conclusion,
  startedAt: "2026-10-30T10:00:00Z",
  completedAt: status === "COMPLETED" ? "2026-10-30T10:01:31Z" : null,
  detailsUrl: `https://github.com/acme/web/actions/runs/1/job/${name}`,
})

const job = (o: Partial<CiJob> = {}): CiJob => ({
  name: "test",
  state: "success",
  startedAt: null,
  completedAt: null,
  url: null,
  ...o,
})

const wf = (o: Partial<CiWorkflow> = {}): CiWorkflow => ({
  key: "CS_1",
  name: "CI",
  file: "ci.yml",
  event: "pull_request",
  runId: 42,
  jobs: [],
  ...o,
})

test("un check run en cours ou en file suit son status, terminé sa conclusion", () => {
  assert.equal(runState("IN_PROGRESS", null), "running")
  assert.equal(runState("QUEUED", null), "queued")
  assert.equal(runState("WAITING", null), "queued")
  assert.equal(runState("COMPLETED", "SUCCESS"), "success")
  assert.equal(runState("COMPLETED", "TIMED_OUT"), "failure")
  assert.equal(runState("COMPLETED", "STARTUP_FAILURE"), "failure")
  assert.equal(runState("COMPLETED", "CANCELLED"), "cancelled")
  assert.equal(runState("COMPLETED", "SKIPPED"), "skipped")
  assert.equal(runState("COMPLETED", "STALE"), "neutral")
})

test("un statut de commit en erreur est un échec, en attente est en cours", () => {
  assert.equal(contextState("ERROR"), "failure")
  assert.equal(contextState("EXPECTED"), "running")
  assert.equal(contextState("SUCCESS"), "success")
})

test("une check suite devient une boîte titrée par son workflow, son fichier et son déclencheur", () => {
  const [box] = toCiView(
    raw({
      checkSuites: {
        nodes: [
          {
            id: "CS_1",
            app: { name: "GitHub Actions" },
            workflowRun: {
              databaseId: 42,
              event: "pull_request",
              file: { path: ".github/workflows/ci.yml" },
              workflow: { name: "CI" },
            },
            checkRuns: { nodes: [run("check")] },
          },
        ],
      },
    }),
  )
  assert.deepEqual(
    { ...box, jobs: box.jobs.map((j) => j.name) },
    {
      key: "CS_1",
      name: "CI",
      file: "ci.yml",
      event: "pull_request",
      runId: 42,
      jobs: ["check"],
    },
  )
})

test("une app sans check run est masquée, une app hors Actions est titrée par son nom", () => {
  const view = toCiView(
    raw({
      checkSuites: {
        nodes: [
          {
            id: "CS_1",
            app: { name: "Netlify" },
            workflowRun: null,
            checkRuns: { nodes: [] },
          },
          {
            id: "CS_2",
            app: { name: "Codecov" },
            workflowRun: null,
            checkRuns: { nodes: [run("coverage")] },
          },
        ],
      },
    }),
  )
  assert.deepEqual(
    view.map((w) => [w.name, w.runId]),
    [["Codecov", null]],
  )
})

test("les statuts de commit forment une dernière boîte sans durée", () => {
  const view = toCiView(
    raw({
      status: {
        contexts: [
          {
            context: "ci/circleci",
            state: "FAILURE",
            targetUrl: "https://circleci.com/x",
            createdAt: "2026-10-30T10:00:00Z",
          },
        ],
      },
    }),
  )
  assert.equal(view.length, 1)
  assert.equal(view[0].name, null)
  assert.deepEqual(view[0].jobs[0], {
    name: "ci/circleci",
    state: "failure",
    startedAt: null,
    completedAt: null,
    url: "https://circleci.com/x",
  })
})

test("une PR introuvable donne une vue vide", () => {
  assert.deepEqual(toCiView({ repository: { pullRequest: null } }), [])
})

test("la relance des jobs en échec est proposée sur un workflow Actions terminé en échec", () => {
  assert.equal(canRerun(wf({ jobs: [job({ state: "failure" })] })), true)
})

test("pas de relance tant qu'un job du workflow tourne", () => {
  assert.equal(
    canRerun(
      wf({ jobs: [job({ state: "failure" }), job({ state: "queued" })] }),
    ),
    false,
  )
})

test("pas de relance sans workflow run (statuts, app hors Actions)", () => {
  assert.equal(
    canRerun(wf({ runId: null, jobs: [job({ state: "failure" })] })),
    false,
  )
})

test("la durée d'un job terminé va du début à la fin", () => {
  const j = job({
    startedAt: "2026-10-30T10:00:00Z",
    completedAt: "2026-10-30T10:01:31Z",
  })
  assert.equal(jobDurationMs(j, 0), 91_000)
})

test("la durée d'un job en cours court jusqu'à maintenant", () => {
  const j = job({ state: "running", startedAt: "2026-10-30T10:00:00Z" })
  assert.equal(jobDurationMs(j, Date.parse("2026-10-30T10:00:05Z")), 5_000)
})

test("pas de durée pour un job pas encore commencé", () => {
  assert.equal(jobDurationMs(job({ state: "queued" }), Date.now()), null)
})

test("la durée s'affiche comme sur GitHub", () => {
  assert.equal(formatDuration(31_400), "31s")
  assert.equal(formatDuration(91_000), "1m 31s")
  assert.equal(formatDuration(3_720_000), "1h 2m")
})

test("un refus 403 de la relance nomme le droit Actions manquant", () => {
  assert.match(rerunError(403, "Resource not accessible"), /Actions/)
  assert.doesNotMatch(rerunError(422, "Run is not completed"), /Actions/)
})

test("un lien de job hors https n'est pas gardé (la ligne n'est pas un lien)", () => {
  const ctx = (targetUrl: string) => ({
    context: "ci/x",
    state: "SUCCESS",
    targetUrl,
    createdAt: "2026-10-30T10:00:00Z",
  })
  const [box] = toCiView(
    raw({
      status: {
        contexts: [
          ctx("javascript:alert(1)"),
          ctx("http://ci.example.com/1"),
          ctx("https://ci.example.com/2"),
        ],
      },
    }),
  )
  assert.deepEqual(
    box.jobs.map((j) => j.url),
    [null, null, "https://ci.example.com/2"],
  )
})
