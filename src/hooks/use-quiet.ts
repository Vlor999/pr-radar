import { useEffect, useState } from "react"

import { locale } from "@/lib/i18n"
import {
  manualPause,
  pausedUntil,
  pauseEnd,
  sameDay,
  systemZone,
  zoneOf,
  type PauseChoice,
} from "@/lib/quiet"
import { getSettings, updateSettings, useSettings } from "@/lib/settings"

/** relecture de l'état : une pause ou une plage qui se termine est vue dans la minute */
const TICK_MS = 30_000

/** État « Ne pas déranger », recalculé aux changements de réglages et toutes les 30 s. */
export function useQuiet() {
  const s = useSettings()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  // réglage changé : relu tout de suite, sans attendre le prochain tic
  useEffect(
    () => setNow(new Date()),
    [s.pauseUntil, s.quietHours, s.quietTimeZone],
  )
  return {
    until: pausedUntil(s, now),
    manual: manualPause(s, now),
    zone: zoneOf(s),
  }
}

export const pause = (choice: PauseChoice) =>
  updateSettings({ pauseUntil: pauseEnd(choice, new Date(), getSettings()) })

export const resume = () => updateSettings({ pauseUntil: null })

/** Fin de pause lisible, à l'heure du fuseau : précédée du jour si ce n'est pas aujourd'hui, suivie du fuseau s'il n'est pas celui du système. */
export const formatUntil = (d: Date, zone: string, now = new Date()) =>
  d.toLocaleString(locale(), {
    timeZone: zone,
    ...(!sameDay(d, now, zone) && { weekday: "long" }),
    hour: "2-digit",
    minute: "2-digit",
    ...(zone !== systemZone() && { timeZoneName: "short" }),
  })
