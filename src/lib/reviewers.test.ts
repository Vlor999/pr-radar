import assert from "node:assert/strict"
import { test } from "node:test"

import {
  dmRecipients,
  matchRecipients,
  normalizeName,
  reviewerCandidates,
  settledPending,
  withPending,
  type Reviewer,
} from "./reviewers.ts"
import type { SlackMention } from "./types.ts"

const u = (login: string, extra: Partial<Reviewer> = {}): Reviewer => ({
  login,
  id: `id-${login}`,
  ...extra,
})
const mention = (extra: Partial<SlackMention> = {}): SlackMention => ({
  author: "me",
  channelId: "D1",
  where: "DM · Alice",
  at: "2026-10-21T10:00:00.000Z",
  text: "",
  permalink: "https://acme.slack.com/archives/D1/p1",
  ...extra,
})
const logins = (rs: Reviewer[]) => rs.map((r) => r.login)

test("les suggestions passent avant les utilisateurs assignables", () => {
  assert.deepEqual(
    logins(reviewerCandidates([u("bob")], [u("alice"), u("carol")], [])),
    ["bob", "alice", "carol"],
  )
})

test("un login présent dans les deux listes n'apparaît qu'une fois", () => {
  assert.deepEqual(
    logins(reviewerCandidates([u("Bob")], [u("bob"), u("alice")], [])),
    ["Bob", "alice"],
  )
})

test("l'auteur et les reviews déjà demandées sont exclus, casse ignorée", () => {
  assert.deepEqual(
    logins(
      reviewerCandidates(
        [u("alice"), u("bob")],
        [u("Me"), u("carol")],
        ["me", "ALICE"],
      ),
    ),
    ["bob", "carol"],
  )
})

test("nom normalisé : casse, accents, espaces et ponctuation ignorés", () => {
  assert.equal(normalizeName("Élodie  D'Arc-Lemaître"), "elodiedarclemaitre")
})

test("destinataires de DM sans doublon, mentions de channel ignorées", () => {
  const erin = { id: "U2", names: ["Erin Laurent"] }
  assert.deepEqual(
    dmRecipients([
      mention({ recipient: erin }),
      mention({ channelId: "C1", where: "#dev" }),
      mention({ recipient: erin }),
    ]),
    [erin],
  )
})

test("destinataire rapproché par le nom GitHub ou le login, accents et casse ignorés", () => {
  const users = [
    u("erin-l", { name: "Érin Laurent" }),
    u("Alice_Martin"),
    u("bob", { name: "Bob Durand" }),
  ]
  assert.deepEqual(
    logins(
      matchRecipients(
        [
          { id: "U1", names: ["alice.martin"] },
          { id: "U2", names: ["Erin Laurent", "Erin"] },
        ],
        users,
      ),
    ),
    ["Alice_Martin", "erin-l"],
  )
})

test("un prénom seul ne rapproche personne", () => {
  assert.deepEqual(
    matchRecipients(
      [{ id: "U2", names: ["Erin"] }],
      [u("erin-l", { name: "Erin Laurent" })],
    ),
    [],
  )
})

test("le destinataire d'un DM passe en tête, marqué, sans doublon avec les suggestions", () => {
  const out = reviewerCandidates(
    [u("bob"), u("erin")],
    [u("carol")],
    [],
    [u("erin")],
  )
  assert.deepEqual(logins(out), ["erin", "bob", "carol"])
  assert.equal(out[0].slack, true)
  assert.equal(out[1].slack, undefined)
})

test("un destinataire déjà demandé ou moi-même n'est pas proposé", () => {
  assert.deepEqual(
    logins(reviewerCandidates([], [], ["me", "erin"], [u("Erin"), u("me")])),
    [],
  )
})

test("une demande en attente s'ajoute aux reviews demandées, sans doublon une fois relue", () => {
  assert.deepEqual(
    withPending(
      [{ who: "Bob" }, { who: "erin", team: true }],
      [
        { login: "bob", sentAt: 1 },
        { login: "erin", sentAt: null },
      ],
    ),
    [{ who: "Bob" }, { who: "erin", team: true }, { who: "erin" }],
  )
})

test("un chargement efface les demandes acceptées avant son départ, pas les autres", () => {
  assert.deepEqual(
    settledPending(
      {
        a: [
          { login: "bob", sentAt: 100 },
          { login: "carol", sentAt: null },
          { login: "dave", sentAt: 300 },
        ],
        b: [{ login: "erin", sentAt: 150 }],
      },
      200,
    ),
    {
      a: [
        { login: "carol", sentAt: null },
        { login: "dave", sentAt: 300 },
      ],
    },
  )
})
