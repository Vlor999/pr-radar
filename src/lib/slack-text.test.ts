import assert from "node:assert/strict"
import { test } from "node:test"

import { slackParts, spoofedHost } from "./slack-text.ts"

test("les liens restent cliquables, avec ou sans libellé", () => {
  assert.deepEqual(
    slackParts(
      "PR <https://github.com/acme/web/pull/12|#12> et <https://x.dev>",
    ),
    [
      { text: "PR " },
      { text: "#12", href: "https://github.com/acme/web/pull/12" },
      { text: " et " },
      { text: "https://x.dev", href: "https://x.dev" },
    ],
  )
})

test("mentions de personnes, de channels et @here en texte", () => {
  assert.deepEqual(
    slackParts("<@U1|Alice> <@U2> <#C1|dev> <!here> <!subteam^S1|@devs>"),
    [
      { text: "@Alice" },
      { text: " " },
      { text: "@U2" },
      { text: " " },
      { text: "#dev" },
      { text: " " },
      { text: "@here" },
      { text: " " },
      { text: "@devs" },
    ],
  )
})

test("sauts de ligne, puces et entités gardés, sans lien hors http(s)", () => {
  assert.deepEqual(
    slackParts(
      "a &amp; b\n• &lt;c&gt;\n<mailto:x@y.z|écrire> <javascript:alert(1)|x>",
    ),
    [
      { text: "a & b\n• <c>\n" },
      { text: "écrire" },
      { text: " " },
      { text: "x" },
    ],
  )
})

test("hôte de la cible quand le libellé est l'URL d'un autre hôte", () => {
  const host = (text: string, href: string) => spoofedHost({ text, href })
  assert.equal(
    host("https://github.com/acme/web/pull/12", "https://evil.dev/x"),
    "evil.dev",
  )
  assert.equal(
    host("github.com/acme/web/pull/12", "https://evil.dev"),
    "evil.dev",
  )
  assert.equal(
    host("https://GitHub.com/acme", "https://github.com/acme/web/pull/12"),
    undefined,
  )
  assert.equal(host("#12", "https://evil.dev"), undefined)
  assert.equal(host("voir la PR", "https://evil.dev"), undefined)
  assert.equal(host("https://x.dev", "https://x.dev"), undefined)
  assert.equal(host("texte", ""), undefined)
  assert.equal(host("github.com", "https://"), undefined)
})
