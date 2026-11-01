import { useSyncExternalStore } from "react"

import {
  LOG_CUSTOM_DAYS_DEFAULT,
  LOG_CUSTOM_DAYS_MAX,
  LOG_CUSTOM_DAYS_MIN,
} from "./constants.ts"

/**
 * Réglages du journal local, gardés dans la fenêtre de l'app seulement : clé hors de la copie partagée
 * avec la version web (`LOCAL_ONLY` de sync.ts, `KV_LOCAL_ONLY` de web.rs). Le navigateur ne peut donc
 * ni lire le dossier choisi (chemin de la machine) ni le changer.
 */
export const LOG_SETTINGS_KEY = "pr-radar:log-settings"

export type LogRetention = "24h" | "7d" | "custom"

export type LogSettings = {
  /** journal tenu ; activé par défaut */
  enabled: boolean
  /** conservation : 24 h, 7 jours, ou `retentionDays` jours */
  retention: LogRetention
  /** jours gardés en conservation personnalisée */
  retentionDays: number
  /** dossier choisi ; null = dossier par défaut de l'app */
  dir: string | null
}

export const DEFAULT_LOG_SETTINGS: LogSettings = {
  enabled: true,
  retention: "7d",
  retentionDays: LOG_CUSTOM_DAYS_DEFAULT,
  dir: null,
}

/** Jours de conservation personnalisée : entier entre les bornes, sinon la valeur par défaut. */
export const logDaysOf = (v: unknown): number =>
  Number.isInteger(v) &&
  (v as number) >= LOG_CUSTOM_DAYS_MIN &&
  (v as number) <= LOG_CUSTOM_DAYS_MAX
    ? (v as number)
    : LOG_CUSTOM_DAYS_DEFAULT

/** Réglages enregistrés (JSON) : valeurs invalides remplacées par celles par défaut. */
export function parseLogSettings(raw: string | null): LogSettings {
  try {
    const s = (JSON.parse(raw ?? "{}") ?? {}) as Partial<LogSettings>
    return {
      enabled: s.enabled !== false,
      retention: ["24h", "7d", "custom"].includes(s.retention ?? "")
        ? s.retention!
        : DEFAULT_LOG_SETTINGS.retention,
      retentionDays: logDaysOf(s.retentionDays),
      dir: typeof s.dir === "string" && s.dir.trim() ? s.dir : null,
    }
  } catch {
    return DEFAULT_LOG_SETTINGS
  }
}

const read = (): LogSettings => {
  try {
    return parseLogSettings(localStorage.getItem(LOG_SETTINGS_KEY))
  } catch {
    return DEFAULT_LOG_SETTINGS
  }
}

let current = read()
const listeners = new Set<() => void>()

export const getLogSettings = () => current

export function updateLogSettings(patch: Partial<LogSettings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(LOG_SETTINGS_KEY, JSON.stringify(current))
  } catch {
    // stockage indisponible : réglage gardé pour cette session
  }
  listeners.forEach((l) => l())
}

export const useLogSettings = (): LogSettings =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
