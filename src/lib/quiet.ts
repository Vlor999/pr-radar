import type { Settings } from "./settings"

/**
 * « Ne pas déranger » : pause manuelle (jusqu'à une date) et plage quotidienne. Logique pure.
 * Heures de la plage et « jusqu'à demain » : dans le fuseau choisi, celui du système par défaut.
 */

export const HOUR_MS = 3_600_000
export const MINUTE_MS = 60_000
/** « Jusqu'à demain » : reprise au prochain matin, à cette heure */
const MORNING_HOUR = 8

export type Quiet = Pick<
  Settings,
  "pauseUntil" | "quietHours" | "quietTimeZone"
>
export type PauseChoice = "hour" | "tomorrow"

/** Fuseau IANA du système (ex. "Europe/Paris"). */
export const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Fuseau des heures de la plage : celui choisi, sinon celui du système. */
export const zoneOf = (q: Pick<Quiet, "quietTimeZone">) =>
  q.quietTimeZone ?? systemZone()

/** Nom canonique d'un fuseau connu du moteur JS (casse, alias : "Etc/UTC" → "UTC"), sinon null. */
export const normalZone = (zone: string): string | null => {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
      .timeZone
  } catch {
    return null
  }
}

/** "HH:MM" (00:00 à 23:59) en minutes depuis minuit, sinon null. */
export const parseHm = (s: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number }

/** Date et heure affichées par une horloge du fuseau `zone` à l'instant `t`. */
export function wallClock(t: Date, zone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(t)
  const n = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    y: n("year"),
    mo: n("month"),
    d: n("day"),
    h: n("hour"),
    mi: n("minute"),
  }
}

/** Écart du fuseau avec UTC à l'instant `t` (ms, à la minute près). */
const offsetMs = (t: number, zone: string) => {
  const w = wallClock(new Date(t), zone)
  return (
    Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) -
    Math.floor(t / MINUTE_MS) * MINUTE_MS
  )
}

/** Instant où l'horloge du fuseau affiche ce jour à `minutes` (jour hors bornes : normalisé). Heure sautée au passage à l'heure d'été : décalée d'une heure. */
const zonedTime = (
  y: number,
  mo: number,
  d: number,
  minutes: number,
  zone: string,
) => {
  const asUtc = Date.UTC(y, mo - 1, d, 0, minutes)
  // deux passes : l'écart peut changer entre l'estimation et l'instant visé (jour de changement d'heure)
  const first = asUtc - offsetMs(asUtc, zone)
  return asUtc - offsetMs(first, zone)
}

/** Prochaine occurrence de l'heure `minutes` du fuseau, strictement après `now`. */
const nextAt = (now: Date, minutes: number, zone: string) => {
  const w = wallClock(now, zone)
  const today = zonedTime(w.y, w.mo, w.d, minutes, zone)
  return new Date(
    today > now.getTime()
      ? today
      : zonedTime(w.y, w.mo, w.d + 1, minutes, zone),
  )
}

/** Dans la plage quotidienne du fuseau (début inclus, fin exclue) ; une plage peut passer minuit. */
export function inQuietHours(
  q: Quiet["quietHours"],
  now: Date,
  zone: string,
): boolean {
  const start = parseHm(q.start)
  const end = parseHm(q.end)
  if (!q.enabled || start === null || end === null || start === end)
    return false
  const w = wallClock(now, zone)
  const m = w.h * 60 + w.mi
  return start < end ? m >= start && m < end : m >= start || m < end
}

/** Pause manuelle en cours. */
export const manualPause = (q: Pick<Quiet, "pauseUntil">, now: Date) =>
  q.pauseUntil !== null && now.getTime() < q.pauseUntil

/** Une notification de PR Radar peut-elle partir maintenant ? */
export const notificationsAllowed = (q: Quiet, now: Date) =>
  !manualPause(q, now) && !inQuietHours(q.quietHours, now, zoneOf(q))

/** Fin de la pause en cours (pause manuelle et plage enchaînées), null si les notifications passent. */
export function pausedUntil(q: Quiet, now: Date): Date | null {
  const zone = zoneOf(q)
  let t = now
  // pause manuelle → plage → pause manuelle : au plus quelques sauts
  for (let i = 0; i < 4; i++) {
    if (manualPause(q, t)) t = new Date(q.pauseUntil!)
    else if (inQuietHours(q.quietHours, t, zone))
      t = nextAt(t, parseHm(q.quietHours.end)!, zone)
    else break
  }
  return t > now ? t : null
}

/** Date de fin d'une pause choisie maintenant (ms) ; « demain » : prochain 8 h du fuseau. */
export const pauseEnd = (
  choice: PauseChoice,
  now: Date,
  q: Pick<Quiet, "quietTimeZone">,
): number =>
  choice === "hour"
    ? now.getTime() + HOUR_MS
    : nextAt(now, MORNING_HOUR * 60, zoneOf(q)).getTime()

/** Même jour du calendrier dans le fuseau. */
export const sameDay = (a: Date, b: Date, zone: string) => {
  const x = wallClock(a, zone)
  const y = wallClock(b, zone)
  return x.y === y.y && x.mo === y.mo && x.d === y.d
}
