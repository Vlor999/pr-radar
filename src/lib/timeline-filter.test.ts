import assert from "node:assert/strict"
import { test } from "node:test"

import {
  applyFilters,
  dropLastToken,
  filtersActive,
  highlight,
  NO_FILTERS,
  normalize,
  pickSuggestion,
  suggestions,
  type TimelineFilters,
} from "./timeline-filter.ts"
import type { TimelineRow } from "./timeline.ts"

const row = (number: number, extra: Partial<TimelineRow> = {}): TimelineRow => {
  const repo = extra.repo ?? "acme/web"
  return {
    repo,
    number,
    title: `PR ${number}`,
    url: "",
    state: "OPEN",
    draft: false,
    author: "me",
    mine: true,
    createdAt: "2026-01-01T00:00:00Z",
    events: [],
    key: `${repo}#${number}`,
    t0: 0,
    tEnd: 0,
    last: 0,
    finished: false,
    status: "open",
    ...extra,
  }
}
const f = (extra: Partial<TimelineFilters>) => ({ ...NO_FILTERS, ...extra })

test("la recherche ignore accents, casse et #", () => {
  assert.equal(normalize("  Équipe  #42 "), "equipe 42")
})

test("le texte tapé filtre par repo, numéro ou titre", () => {
  const rows = [
    row(1, { title: "Créer l'export" }),
    row(2, { repo: "acme/api" }),
  ]
  assert.deepEqual(
    applyFilters(rows, f({ q: "creer" }), []).map((r) => r.number),
    [1],
  )
  assert.deepEqual(
    applyFilters(rows, f({ q: "#2" }), []).map((r) => r.number),
    [2],
  )
  assert.deepEqual(
    applyFilters(rows, f({ q: "api" }), []).map((r) => r.number),
    [2],
  )
})

test("les jetons gardent les PR choisies et celles des repos choisis", () => {
  const rows = [
    row(1),
    row(2, { repo: "acme/api" }),
    row(3, { repo: "acme/infra" }),
  ]
  const shown = applyFilters(
    rows,
    f({ repos: ["acme/api"], prs: ["acme/web#1"] }),
    [],
  )
  assert.deepEqual(
    shown.map((r) => r.number),
    [1, 2],
  )
})

test("le filtre « Les autres » garde les PR dont je ne suis pas l'auteur", () => {
  const rows = [row(1), row(2, { mine: false, author: "ada" })]
  assert.deepEqual(
    applyFilters(rows, f({ owner: "others" }), []).map((r) => r.number),
    [2],
  )
})

test("le filtre d'état garde les PR mergées", () => {
  const rows = [row(1), row(2, { status: "merged", finished: true })]
  assert.deepEqual(
    applyFilters(rows, f({ status: "merged" }), []).map((r) => r.number),
    [2],
  )
})

test("une PR masquée n'est pas affichée", () => {
  assert.equal(applyFilters([row(1)], NO_FILTERS, ["acme/web#1"]).length, 0)
})

test("sans filtre, rien n'est actif", () => {
  assert.equal(filtersActive(NO_FILTERS), false)
  assert.equal(filtersActive(f({ owner: "mine" })), true)
})

test("champ vide : tous les repos puis les PR récentes", () => {
  const s = suggestions([row(1), row(2, { repo: "acme/api" })], "", NO_FILTERS)
  assert.deepEqual(
    s.map((x) => (x.type === "repo" ? x.repo : x.row.key)),
    ["acme/api", "acme/web", "acme/web#1", "acme/api#2"],
  )
})

test("une proposition déjà choisie est marquée", () => {
  const s = suggestions([row(1)], "web", f({ repos: ["acme/web"] }))
  assert.equal(s[0].selected, true)
})

test("rechoisir une proposition retire son jeton", () => {
  const [repo] = suggestions([row(1)], "", NO_FILTERS)
  const once = pickSuggestion(f({ q: "we" }), repo)
  assert.deepEqual(once.repos, ["acme/web"])
  assert.equal(once.q, "")
  assert.deepEqual(pickSuggestion(once, { ...repo, selected: true }).repos, [])
})

test("retour arrière retire la dernière PR choisie avant les repos", () => {
  const next = dropLastToken(f({ repos: ["acme/web"], prs: ["acme/api#2"] }))
  assert.deepEqual([next.repos, next.prs], [["acme/web"], []])
})

test("le surlignage retrouve le texte d'origine malgré les accents", () => {
  assert.deepEqual(highlight("Créer l'export", "cree"), [
    "",
    "Crée",
    "r l'export",
  ])
})

test("le surlignage d'un numéro ignore le #", () => {
  assert.deepEqual(highlight("42", "#42"), ["", "42", ""])
})

test("pas de surlignage sans correspondance", () => {
  assert.equal(highlight("export", "zz"), null)
})
