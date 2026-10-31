import assert from "node:assert/strict"
import { test } from "node:test"

import {
  editDistance,
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

// fautes de frappe

const NOTIFS = entry({
  id: "notifs",
  category: "notifications",
  label: "Notifications",
})
const CACHE = entry({ id: "cache", category: "advanced", label: "Cache" })
const FOCUS = entry({
  id: "focus",
  category: "notifications",
  label: "Modes Concentration",
  keywords: "focus",
})
const find = (query: string, index = [NOTIFS, CACHE, FOCUS]) =>
  ids(flatResults(searchSettings(index, query, "general")))

test("editDistance compte une transposition comme une seule faute", () => {
  assert.equal(editDistance("cahce", "cache"), 1)
  assert.equal(editDistance("cache", "cache"), 0)
  assert.equal(editDistance("notifcation", "notification"), 1)
})

test("un début de mot suffit", () => {
  assert.deepEqual(find("notif"), ["notifs"])
})

test("une lettre oubliée dans un mot long est tolérée", () => {
  assert.deepEqual(find("notifcation"), ["notifs"])
})

test("deux lettres inversées sont tolérées", () => {
  assert.deepEqual(find("cahce"), ["cache"])
})

test("une faute est tolérée dans les mots-clés", () => {
  assert.deepEqual(find("ofcus"), ["focus"])
})

test("accents et faute de frappe se cumulent", () => {
  const reset = [entry({ id: "reset", label: "Réinitialiser les réglages" })]
  const params = [entry({ id: "params", label: "Paramètres" })]
  assert.deepEqual(find("reglgaes", reset), ["reset"])
  assert.deepEqual(find("parametrse", params), ["params"])
  assert.deepEqual(find("parametre", params), ["params"])
})

test("deux fautes tolérées à partir de 8 lettres, une seule en dessous", () => {
  assert.deepEqual(find("nitifcation"), ["notifs"])
  assert.deepEqual(find("cxhce"), [])
})

test("sous 4 lettres, pas de tolérance aux fautes", () => {
  assert.deepEqual(find("cah"), [])
  assert.deepEqual(find("cac"), ["cache"])
})

test("une correspondance exacte passe avant une faute de frappe", () => {
  const index = [
    entry({ id: "typo", label: "Caches" }),
    entry({ id: "exact", label: "Cache" }),
    entry({ id: "close", label: "Cahce" }),
  ]
  assert.deepEqual(find("cahce", index), ["close", "typo", "exact"])
  assert.deepEqual(find("cache", index), ["exact", "typo", "close"])
})

test("une faute dans la description passe après tout libellé trouvé", () => {
  const index = [
    entry({ id: "desc", label: "Autre", description: "cache" }),
    entry({ id: "label", label: "Cachette" }),
  ]
  assert.deepEqual(find("cahce", index), ["label", "desc"])
})

test("les groupes de catégories restent ordonnés, triés par score à l'intérieur", () => {
  const index = [
    entry({ id: "g", category: "general", label: "Cache" }),
    entry({ id: "a1", category: "advanced", label: "Cachr" }),
    entry({ id: "a2", category: "advanced", label: "Cache" }),
    entry({ id: "n", category: "notifications", label: "Cache" }),
  ]
  const r = searchSettings(index, "cache", "notifications")
  assert.deepEqual(ids(r.current), ["n"])
  assert.deepEqual(
    r.others.map((g) => [g.category, ids(g.entries)]),
    [
      ["general", ["g"]],
      ["advanced", ["a2", "a1"]],
    ],
  )
})
