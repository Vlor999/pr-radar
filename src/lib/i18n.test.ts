import assert from "node:assert/strict"
import { test } from "node:test"

// settings.ts lit localStorage au chargement : le faux stockage doit exister avant l'import
let saved = JSON.stringify({ lang: "de" })
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => saved,
    setItem: (_: string, v: string) => (saved = v),
    removeItem: () => {},
  },
})
const { getSettings, resetSettings, updateSettings } =
  await import("./settings.ts")
const { currentLang } = await import("./i18n.ts")

test("une langue enregistrée inconnue est ignorée : la question est reposée", () => {
  assert.equal(getSettings().lang, null)
})

test("sans choix, la langue suit le système", () => {
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: "fr-CA",
  })
  assert.equal(currentLang(null), "fr")
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: "de-DE",
  })
  assert.equal(currentLang(null), "en")
  assert.equal(currentLang("fr"), "fr")
})

test("réinitialiser les réglages garde la langue", () => {
  updateSettings({ lang: "en", staleDays: 12 })
  resetSettings()
  assert.equal(getSettings().lang, "en")
  assert.equal(getSettings().staleDays, 5)
})
