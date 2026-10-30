import assert from "node:assert/strict"
import { test } from "node:test"

import {
  applyPatch,
  DEFAULT_SETTINGS,
  parseSettings,
  refreshMinutesOf,
  shouldNotify,
} from "./settings.ts"
import type { Pr } from "./types.ts"

const pr = (draft: boolean) => ({ draft }) as Pr
const noDrafts = { ...DEFAULT_SETTINGS, notifyDrafts: false }

test("par défaut, une PR brouillon est notifiée", () => {
  assert.equal(shouldNotify(DEFAULT_SETTINGS, pr(true), "approved"), true)
})

test("réglage brouillons décoché : une PR brouillon n'est pas notifiée", () => {
  assert.equal(shouldNotify(noDrafts, pr(true), "approved"), false)
})

test("réglage brouillons décoché : une PR prête reste notifiée", () => {
  assert.equal(shouldNotify(noDrafts, pr(false), "approved"), true)
})

test("un type de changement décoché n'est pas notifié", () => {
  const s = {
    ...DEFAULT_SETTINGS,
    notify: { ...DEFAULT_SETTINGS.notify, ciFailed: false },
  }
  assert.equal(shouldNotify(s, pr(false), "ciFailed"), false)
})

test("réglage brouillons décoché : une demande de review sur un brouillon n'est pas notifiée", () => {
  assert.equal(
    shouldNotify(noDrafts, { draft: true }, "reviewRequested"),
    false,
  )
})

test("fréquence enregistrée : auto et minutes entières >= 0 gardées", () => {
  assert.equal(refreshMinutesOf("auto"), "auto")
  assert.equal(refreshMinutesOf(0), 0)
  assert.equal(refreshMinutesOf(10), 10)
})

test("fréquence invalide (non entière, négative, inconnue) : valeur par défaut", () => {
  for (const v of [2.5, -1, "5", null, undefined])
    assert.equal(refreshMinutesOf(v), DEFAULT_SETTINGS.refreshMinutes)
})

test("un changement de réglage appliqué aux réglages partagés garde leurs autres champs", () => {
  const remote = JSON.stringify({ ...DEFAULT_SETTINGS, staleDays: 9 })
  const s = applyPatch(parseSettings(remote), { mergedDays: 3 })
  assert.equal(s.staleDays, 9)
  assert.equal(s.mergedDays, 3)
})

test("des réglages partagés absents reprennent les valeurs par défaut", () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS)
})

test("ne pas déranger : plage et pause mal formées remplacées par les valeurs par défaut", () => {
  const s = parseSettings(
    JSON.stringify({
      pauseUntil: "demain",
      quietHours: { enabled: true, start: "25:00", end: "07:30" },
    }),
  )
  assert.equal(s.pauseUntil, null)
  assert.deepEqual(s.quietHours, {
    enabled: true,
    start: "22:00",
    end: "07:30",
  })
})

test("fuseau de la plage : inconnu remplacé par celui du système (null)", () => {
  assert.equal(
    parseSettings('{"quietTimeZone":"Mars/Olympus"}').quietTimeZone,
    null,
  )
  assert.equal(
    parseSettings('{"quietTimeZone":"Asia/Tokyo"}').quietTimeZone,
    "Asia/Tokyo",
  )
})
