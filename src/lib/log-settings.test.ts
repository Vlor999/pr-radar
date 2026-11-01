import assert from "node:assert/strict"
import { test } from "node:test"

import { isSynced } from "./sync.ts"
import {
  DEFAULT_LOG_SETTINGS,
  LOG_SETTINGS_KEY,
  parseLogSettings,
} from "./log-settings.ts"

test("réglages du journal : activé, 7 jours et dossier par défaut sans valeur enregistrée", () => {
  assert.deepEqual(parseLogSettings(null), DEFAULT_LOG_SETTINGS)
})

test("réglages du journal : valeurs invalides remplacées par celles par défaut", () => {
  assert.deepEqual(
    parseLogSettings(
      JSON.stringify({
        enabled: false,
        retention: "1y",
        retentionDays: 0,
        dir: "  ",
      }),
    ),
    { ...DEFAULT_LOG_SETTINGS, enabled: false },
  )
  assert.deepEqual(parseLogSettings("not json"), DEFAULT_LOG_SETTINGS)
})

test("réglages du journal : conservation personnalisée et dossier choisi gardés", () => {
  assert.deepEqual(
    parseLogSettings(
      JSON.stringify({
        retention: "custom",
        retentionDays: 90,
        dir: "/Users/me/logs",
      }),
    ),
    {
      enabled: true,
      retention: "custom",
      retentionDays: 90,
      dir: "/Users/me/logs",
    },
  )
})

test("réglages du journal : jamais partagés avec la version web", () => {
  assert.equal(isSynced(LOG_SETTINGS_KEY), false)
})
