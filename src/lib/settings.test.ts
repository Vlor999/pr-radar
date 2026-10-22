import assert from "node:assert/strict"
import { test } from "node:test"

import { DEFAULT_SETTINGS, shouldNotify } from "./settings.ts"
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
