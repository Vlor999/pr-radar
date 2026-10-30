import assert from "node:assert/strict"
import { test } from "node:test"

import {
  inQuietHours,
  normalZone,
  notificationsAllowed,
  parseHm,
  pauseEnd,
  pausedUntil,
  wallClock,
  type Quiet,
} from "./quiet.ts"

const PARIS = "Europe/Paris"
const TOKYO = "Asia/Tokyo"
const utc = (iso: string) => new Date(`${iso}Z`)
const quiet = (over: Partial<Quiet> = {}): Quiet => ({
  pauseUntil: null,
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
  quietTimeZone: PARIS,
  ...over,
})
const range = (start: string, end: string, zone = PARIS, enabled = true) =>
  quiet({ quietHours: { enabled, start, end }, quietTimeZone: zone })

// 30 octobre 2026 : Paris en UTC+1 (heure d'hiver), Tokyo en UTC+9

test("sans pause ni plage, une notification passe", () => {
  assert.equal(notificationsAllowed(quiet(), utc("2026-10-30T11:00")), true)
})

test("pause manuelle en cours : la notification est bloquée", () => {
  const q = quiet({ pauseUntil: utc("2026-10-30T12:00").getTime() })
  assert.equal(notificationsAllowed(q, utc("2026-10-30T11:30")), false)
})

test("pause manuelle expirée : la notification passe", () => {
  const q = quiet({ pauseUntil: utc("2026-10-30T12:00").getTime() })
  assert.equal(notificationsAllowed(q, utc("2026-10-30T12:00")), true)
})

test("plage de journée : bloque entre début inclus et fin exclue, heure de Paris", () => {
  const q = range("12:00", "14:00")
  assert.equal(notificationsAllowed(q, utc("2026-10-30T11:00")), false)
  assert.equal(notificationsAllowed(q, utc("2026-10-30T12:59")), false)
  assert.equal(notificationsAllowed(q, utc("2026-10-30T13:00")), true)
  assert.equal(notificationsAllowed(q, utc("2026-10-30T10:59")), true)
})

test("plage qui passe minuit : bloque le soir et le matin, pas la journée", () => {
  const q = range("22:00", "08:00")
  assert.equal(notificationsAllowed(q, utc("2026-10-30T22:00")), false)
  assert.equal(notificationsAllowed(q, utc("2026-10-31T02:00")), false)
  assert.equal(notificationsAllowed(q, utc("2026-10-31T07:00")), true)
  assert.equal(notificationsAllowed(q, utc("2026-10-30T20:59")), true)
})

test("même instant, autre fuseau : la plage suit l'heure du fuseau choisi", () => {
  const now = utc("2026-10-30T14:00") // 23 h à Tokyo, 15 h à Paris
  assert.equal(notificationsAllowed(range("22:00", "08:00", TOKYO), now), false)
  assert.equal(notificationsAllowed(range("22:00", "08:00", PARIS), now), true)
})

test("plage désactivée, vide ou mal formée : ne bloque rien", () => {
  const now = utc("2026-10-30T22:00")
  assert.equal(
    inQuietHours(range("22:00", "08:00", PARIS, false).quietHours, now, PARIS),
    false,
  )
  assert.equal(
    inQuietHours(range("23:00", "23:00").quietHours, now, PARIS),
    false,
  )
  assert.equal(
    inQuietHours(range("25:00", "08:00").quietHours, now, PARIS),
    false,
  )
})

test("parseHm lit HH:MM et refuse le reste", () => {
  assert.equal(parseHm("08:30"), 510)
  assert.equal(parseHm("23:59"), 1439)
  assert.equal(parseHm("24:00"), null)
  assert.equal(parseHm("8:30"), null)
})

test("normalZone donne le nom canonique d'un fuseau et refuse l'inconnu", () => {
  assert.equal(normalZone("europe/paris"), "Europe/Paris")
  assert.equal(normalZone("Etc/UTC"), "UTC")
  assert.equal(normalZone("Mars/Olympus"), null)
})

test("wallClock donne l'heure locale du fuseau", () => {
  assert.deepEqual(wallClock(utc("2026-10-30T23:30"), TOKYO), {
    y: 2026,
    mo: 10,
    d: 31,
    h: 8,
    mi: 30,
  })
})

test("pause d'une heure : fin une heure plus tard", () => {
  const now = utc("2026-10-30T11:00")
  assert.equal(
    pauseEnd("hour", now, quiet()),
    utc("2026-10-30T12:00").getTime(),
  )
})

test("pause jusqu'à demain le soir : fin le lendemain à 8 h du fuseau", () => {
  const now = utc("2026-10-30T17:00") // 18 h à Paris
  assert.equal(
    pauseEnd("tomorrow", now, quiet()),
    utc("2026-10-31T07:00").getTime(),
  )
})

test("pause jusqu'à demain après minuit : fin le matin même à 8 h", () => {
  const now = utc("2026-10-31T01:00") // 2 h à Paris
  assert.equal(
    pauseEnd("tomorrow", now, quiet()),
    utc("2026-10-31T07:00").getTime(),
  )
})

test("pause jusqu'à demain à Tokyo : 8 h heure de Tokyo", () => {
  const now = utc("2026-10-30T14:00") // 23 h à Tokyo
  assert.equal(
    pauseEnd("tomorrow", now, quiet({ quietTimeZone: TOKYO })),
    utc("2026-10-30T23:00").getTime(),
  )
})

test("passage à l'heure d'hiver pendant la nuit : la plage finit à 8 h, heure d'hiver", () => {
  // nuit du 24 au 25 octobre 2026 : 3 h (UTC+2) devient 2 h (UTC+1) à Paris
  const q = range("22:00", "08:00")
  assert.deepEqual(
    pausedUntil(q, utc("2026-10-24T20:00")),
    utc("2026-10-25T07:00"),
  )
})

test("passage à l'heure d'été pendant la nuit : « jusqu'à demain » finit à 8 h, heure d'été", () => {
  // nuit du 28 au 29 mars 2026 : 2 h (UTC+1) devient 3 h (UTC+2) à Paris
  assert.equal(
    pauseEnd("tomorrow", utc("2026-03-28T21:00"), quiet()),
    utc("2026-03-29T06:00").getTime(),
  )
})

test("fin de pause : rien quand les notifications passent", () => {
  assert.equal(pausedUntil(quiet(), utc("2026-10-30T11:00")), null)
})

test("fin de pause dans une plage qui passe minuit : le lendemain matin", () => {
  assert.deepEqual(
    pausedUntil(range("22:00", "08:00"), utc("2026-10-30T22:00")),
    utc("2026-10-31T07:00"),
  )
})

test("pause manuelle qui finit dans la plage : la fin de la plage l'emporte", () => {
  const q = {
    ...range("22:00", "08:00"),
    pauseUntil: utc("2026-10-30T22:00").getTime(),
  }
  assert.deepEqual(
    pausedUntil(q, utc("2026-10-30T20:00")),
    utc("2026-10-31T07:00"),
  )
})
