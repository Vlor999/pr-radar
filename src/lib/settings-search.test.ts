import assert from "node:assert/strict"
import { test } from "node:test"

import {
  flatResults,
  fold,
  searchSettings,
  type SettingEntry,
} from "./settings-search.ts"

const entry = (over: Partial<SettingEntry> = {}): SettingEntry => ({
  id: "theme",
  category: "general",
  label: "Thème",
  ...over,
})

const ids = (entries: SettingEntry[]) => entries.map((e) => e.id)

test("fold retire accents et majuscules", () => {
  assert.equal(fold("Échap Désinstaller"), "echap desinstaller")
})

test("requête vide : aucun résultat", () => {
  const r = searchSettings([entry()], "  ", "general")
  assert.deepEqual(r, { current: [], others: [], count: 0 })
})

test("la recherche ignore accents et majuscules", () => {
  const r = searchSettings([entry()], "THEME", "general")
  assert.deepEqual(ids(r.current), ["theme"])
})

test("la description et les mots-clés comptent aussi", () => {
  const index = [
    entry({ id: "cache", label: "Cache", description: "Relit tout" }),
    entry({ id: "seen", label: "Marques", keywords: "oublier" }),
  ]
  assert.deepEqual(ids(searchSettings(index, "relit", "general").current), [
    "cache",
  ])
  assert.deepEqual(ids(searchSettings(index, "oublier", "general").current), [
    "seen",
  ])
})

test("chaque mot de la requête doit apparaître", () => {
  const index = [
    entry({ id: "dnd", label: "Ne pas déranger" }),
    entry({ id: "quiet", label: "Plage quotidienne", description: "pas" }),
  ]
  assert.deepEqual(
    ids(searchSettings(index, "pas deranger", "general").current),
    ["dnd"],
  )
})

test("un libellé trouvé passe avant une description trouvée", () => {
  const index = [
    entry({ id: "a", label: "Fréquence", description: "Quota GitHub" }),
    entry({ id: "b", label: "Quota GitHub" }),
  ]
  assert.deepEqual(ids(searchSettings(index, "quota", "general").current), [
    "b",
    "a",
  ])
})

test("la catégorie courante passe d'abord, les autres sont groupées dans l'ordre de l'index", () => {
  const index = [
    entry({ id: "g", category: "general", label: "Actualiser" }),
    entry({ id: "n", category: "notifications", label: "Actualiser" }),
    entry({ id: "p", category: "prs", label: "Actualiser" }),
    entry({ id: "p2", category: "prs", label: "Autre" }),
  ]
  const r = searchSettings(index, "actualiser", "prs")
  assert.deepEqual(ids(r.current), ["p"])
  assert.deepEqual(
    r.others.map((g) => [g.category, ids(g.entries)]),
    [
      ["general", ["g"]],
      ["notifications", ["n"]],
    ],
  )
  assert.equal(r.count, 3)
})

test("flatResults suit l'ordre d'affichage", () => {
  const index = [
    entry({ id: "g", category: "general", label: "Cache" }),
    entry({ id: "a", category: "advanced", label: "Cache" }),
  ]
  const r = searchSettings(index, "cache", "advanced")
  assert.deepEqual(ids(flatResults(r)), ["a", "g"])
})
