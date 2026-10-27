import { test } from "node:test"
import assert from "node:assert/strict"

import { isExternalHref } from "./links.ts"

test("lien https absolu : ouvert dans le navigateur", () => {
  assert.equal(isExternalHref("https://github.com/acme/api/pull/80"), true)
})

test("ancre, lien relatif, mailto: et javascript: : pas ouverts", () => {
  for (const href of [
    "#footnote-1",
    "/acme/api/pull/80",
    "mailto:dev@acme.test",
    "javascript:alert(1)",
    "http://acme.test",
    "",
  ])
    assert.equal(isExternalHref(href), false, href)
})
