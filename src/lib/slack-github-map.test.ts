import assert from "node:assert/strict"
import { test } from "node:test"

import type { Reviewer } from "./reviewers.ts"
import {
  contactKey,
  dmReviewers,
  lookupRecipients,
  parseMap,
  resolveLinks,
  withConfirmed,
  withLink,
  withoutLink,
  type ContactLinks,
  type LinkedAccount,
  type SlackGithubMap,
} from "./slack-github-map.ts"

const TEAM = "T1"
const ERIN = { id: "U2", names: ["Erin Laurent"] }
const FRANK = { id: "U3", names: ["Frank Petit"] }
const KEY = contactKey(TEAM, ERIN.id)

const gh = (
  login: string,
  extra: Partial<LinkedAccount> = {},
): LinkedAccount => ({
  provider: "github",
  login,
  id: `id-${login}`,
  ...extra,
})
const user = (login: string, name: string | null = null): Reviewer => ({
  login,
  id: `id-${login}`,
  name,
})
const links = (extra: Partial<ContactLinks> = {}): ContactLinks => ({
  manual: [],
  excluded: [],
  ...extra,
})
const logins = (rs: { login: string }[]) => rs.map((r) => r.login)

test("table absente ou invalide : vide, entrées invalides ignorées", () => {
  assert.deepEqual(parseMap(null), {})
  assert.deepEqual(parseMap("[1]"), {})
  assert.deepEqual(parseMap("{oops"), {})
  assert.deepEqual(
    parseMap(JSON.stringify({ [KEY]: { manual: [gh("erin"), { login: 1 }] } })),
    { [KEY]: { manual: [gh("erin")], excluded: [] } },
  )
})

test("les liens manuels l'emportent sur le rapprochement automatique", () => {
  const out = resolveLinks(links({ manual: [gh("erin-work")] }), [gh("erin-l")])
  assert.deepEqual(
    out.map((l) => [l.login, l.origin]),
    [["erin-work", "manual"]],
  )
})

test("sans lien manuel, les correspondances automatiques non exclues, plusieurs par contact", () => {
  const out = resolveLinks(links({ excluded: [gh("FPETIT")] }), [
    gh("frank"),
    gh("fpetit"),
    gh("frank-p"),
  ])
  assert.deepEqual(logins(out), ["frank", "frank-p"])
  assert.ok(out.every((l) => l.origin === "auto"))
})

test("retirer un lien automatique l'exclut, retirer un lien manuel le supprime", () => {
  const map: SlackGithubMap = { [KEY]: links({ manual: [gh("erin-work")] }) }
  assert.deepEqual(
    withoutLink(map, KEY, { ...gh("erin-l"), origin: "auto" })[KEY].excluded,
    [gh("erin-l")],
  )
  assert.deepEqual(
    withoutLink(map, KEY, { ...gh("erin-work"), origin: "manual" })[KEY].manual,
    [],
  )
})

test("ajouter à la main un compte exclu le retire des exclusions, sans doublon", () => {
  const map: SlackGithubMap = {
    [KEY]: links({ manual: [gh("erin-l")], excluded: [gh("erin-l")] }),
  }
  assert.deepEqual(withLink(map, KEY, gh("Erin-L"))[KEY], {
    manual: [gh("Erin-L")],
    excluded: [],
  })
})

test("reviewers d'un DM : lien manuel sans recherche, sinon rapprochement par nom", () => {
  const map: SlackGithubMap = { [KEY]: links({ manual: [gh("erin-work")] }) }
  const users = [user("erin-l", "Erin Laurent"), user("frank", "Frank Petit")]
  assert.deepEqual(lookupRecipients([ERIN, FRANK], map, TEAM), [FRANK])
  assert.deepEqual(
    logins(dmReviewers([ERIN, FRANK], map, TEAM, undefined, users)),
    ["erin-work", "frank"],
  )
})

test("un compte exclu n'est jamais proposé, les autres comptes du contact si", () => {
  const map: SlackGithubMap = {
    [contactKey(TEAM, FRANK.id)]: links({ excluded: [gh("fpetit")] }),
  }
  const users = [user("frank", "Frank Petit"), user("fpetit", "Frank Petit")]
  assert.deepEqual(logins(dmReviewers([FRANK], map, TEAM, "acme", users)), [
    "frank",
  ])
})

test("plusieurs comptes PR Radar : un lien manuel ne vaut que pour son compte", () => {
  const map: SlackGithubMap = {
    [KEY]: links({ manual: [gh("erin-ghe", { account: "ghe" })] }),
  }
  const users = [user("erin-l", "Erin Laurent")]
  assert.deepEqual(logins(dmReviewers([ERIN], map, TEAM, "ghe", users)), [
    "erin-ghe",
  ])
  assert.deepEqual(logins(dmReviewers([ERIN], map, TEAM, "github", users)), [
    "erin-l",
  ])
})

test("une exclusion d'un autre compte PR Radar ne s'applique pas", () => {
  const map: SlackGithubMap = {
    [KEY]: links({ excluded: [gh("erin-l", { account: "ghe" })] }),
  }
  const users = [user("erin-l", "Erin Laurent")]
  assert.deepEqual(logins(dmReviewers([ERIN], map, TEAM, "github", users)), [
    "erin-l",
  ])
  assert.deepEqual(dmReviewers([ERIN], map, TEAM, "ghe", users), [])
})

test("sans équipe Slack connue, seul le rapprochement par nom s'applique", () => {
  const map: SlackGithubMap = { [KEY]: links({ manual: [gh("erin-work")] }) }
  assert.deepEqual(
    logins(
      dmReviewers([ERIN], map, undefined, undefined, [
        user("erin-l", "Erin Laurent"),
      ]),
    ),
    ["erin-l"],
  )
})

test("confirmer une correspondance automatique la rend manuelle", () => {
  const map = withConfirmed({}, KEY, { ...gh("erin-l"), origin: "auto" })
  assert.deepEqual(map[KEY], { manual: [gh("erin-l")], excluded: [] })
  assert.deepEqual(
    resolveLinks(map[KEY], [gh("erin-l")]).map((l) => [l.login, l.origin]),
    [["erin-l", "manual"]],
  )
})

test("plusieurs comptes PR Radar : un lien manuel ne masque que les correspondances automatiques de son compte", () => {
  const entry = links({ manual: [gh("erin-ghe", { account: "ghe" })] })
  const out = resolveLinks(entry, [
    gh("erin-l", { account: "github" }),
    gh("erin-l2", { account: "ghe" }),
  ])
  assert.deepEqual(
    out.map((l) => [l.login, l.origin]),
    [
      ["erin-ghe", "manual"],
      ["erin-l", "auto"],
    ],
  )
  const users = [user("erin-l", "Erin Laurent")]
  const map: SlackGithubMap = { [KEY]: entry }
  assert.deepEqual(logins(dmReviewers([ERIN], map, TEAM, "github", users)), [
    "erin-l",
  ])
})

test("un lien manuel sans compte précisé masque les correspondances automatiques de tous les comptes", () => {
  const out = resolveLinks(links({ manual: [gh("erin-work")] }), [
    gh("erin-l", { account: "github" }),
    gh("erin-l2", { account: "ghe" }),
  ])
  assert.deepEqual(logins(out), ["erin-work"])
})
