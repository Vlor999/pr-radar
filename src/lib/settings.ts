import { useSyncExternalStore } from "react"

import type { Lang } from "./i18n"
import type { Who } from "./review"
import { normalZone, parseHm } from "./quiet.ts"
import { onPulled, saveItem } from "./sync.ts" // extension : chargé aussi par node --test

/** Réglages de l'app, gardés dans la fenêtre (localStorage). Chaque clé a une valeur par défaut. */
export type Settings = {
  /** minutes entre deux actualisations automatiques ; 0 = manuelle ; "auto" = selon le quota GitHub */
  refreshMinutes: number | "auto"
  /** actualiser en revenant sur la fenêtre (si la dernière lecture a plus d'une minute) */
  refreshOnFocus: boolean
  notify: {
    approved: boolean
    changesRequested: boolean
    comments: boolean
    ciFailed: boolean
    /** nouvelle demande de review à moi (ou re-request) */
    reviewRequested: boolean
  }
  /** notifier aussi pour les PR brouillon */
  notifyDrafts: boolean
  /** tri par défaut de l'arbre : "priority" | "oldest" | "recent" */
  defaultSort: "priority" | "oldest" | "recent"
  /** jours sans activité avant le badge « inactive » */
  staleDays: number
  /** période de la section « Mergées récemment » sous chaque repo */
  mergedDays: number
  /** repos retirés du panneau latéral */
  hiddenRepos: string[]
  /** langue de l'interface ; null = pas encore choisie (question au premier lancement) */
  lang: Lang | null
  /** mentions Slack : toutes les conversations (actuelles et futures), sans filtre */
  slackAll: boolean
  /** mentions Slack : ids des conversations cochées (ignorés si `slackAll`) */
  slackChannels: string[]
  /** onglet « À reviewer » : chip Tout / Moi / Équipe */
  reviewWho: Who
  /** onglet « À reviewer » : masquer les demandes d'équipe déjà approuvées */
  reviewHideApproved: boolean
  /** serveur MCP local (socket Unix) ; désactivé par défaut */
  mcpEnabled: boolean
  /** ne pas déranger : notifications suspendues jusqu'à cette date (ms) ; null = pas de pause */
  pauseUntil: number | null
  /** ne pas déranger chaque jour, de `start` à `end` ("HH:MM", heure locale, peut passer minuit) */
  quietHours: { enabled: boolean; start: string; end: string }
  /** fuseau IANA de la plage et de « jusqu'à demain » ; null = celui du système */
  quietTimeZone: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  refreshMinutes: "auto",
  refreshOnFocus: true,
  notify: {
    approved: true,
    changesRequested: true,
    comments: true,
    ciFailed: true,
    reviewRequested: true,
  },
  notifyDrafts: true,
  defaultSort: "priority",
  staleDays: 5,
  mergedDays: 7,
  hiddenRepos: [],
  lang: null,
  slackAll: false,
  slackChannels: [],
  reviewWho: "all",
  reviewHideApproved: false,
  mcpEnabled: false,
  pauseUntil: null,
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
  quietTimeZone: null,
}

const KEY = "pr-radar:settings"

/** Fréquence enregistrée : "auto" ou des minutes entières >= 0 ; sinon la valeur par défaut. */
export const refreshMinutesOf = (v: unknown): Settings["refreshMinutes"] =>
  v === "auto" || (Number.isInteger(v) && (v as number) >= 0)
    ? (v as Settings["refreshMinutes"])
    : DEFAULT_SETTINGS.refreshMinutes

/** Plage enregistrée : heures "HH:MM" valides, sinon celles par défaut. */
const quietHoursOf = (v: unknown): Settings["quietHours"] => {
  const d = DEFAULT_SETTINGS.quietHours
  const q = (v ?? {}) as Partial<Settings["quietHours"]>
  const hm = (x: unknown, fallback: string) =>
    typeof x === "string" && parseHm(x) !== null ? x : fallback
  return {
    enabled: q.enabled === true,
    start: hm(q.start, d.start),
    end: hm(q.end, d.end),
  }
}
const listeners = new Set<() => void>()

/** Réglages enregistrés (JSON), complétés par les valeurs par défaut. */
export function parseSettings(raw: string | null): Settings {
  try {
    const saved = JSON.parse(raw ?? "{}") as Partial<Settings>
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      notify: { ...DEFAULT_SETTINGS.notify, ...saved.notify },
      // valeur inconnue (édition à la main, version plus récente) : on repose la question
      lang: saved.lang === "fr" || saved.lang === "en" ? saved.lang : null,
      reviewWho: ["all", "me", "team"].includes(saved.reviewWho ?? "")
        ? saved.reviewWho!
        : "all",
      reviewHideApproved: saved.reviewHideApproved === true,
      mcpEnabled: saved.mcpEnabled === true,
      pauseUntil: Number.isFinite(saved.pauseUntil) ? saved.pauseUntil! : null,
      quietHours: quietHoursOf(saved.quietHours),
      // nom canonique : celui que le choix du fuseau des réglages sait afficher
      quietTimeZone:
        typeof saved.quietTimeZone === "string"
          ? normalZone(saved.quietTimeZone)
          : null,
      refreshMinutes: refreshMinutesOf(saved.refreshMinutes),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function read(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_SETTINGS
  }
}

let current = read()

// réglages changés dans l'autre fenêtre (app ou version web)
onPulled((keys) => {
  if (!keys.includes(KEY)) return
  current = read()
  listeners.forEach((l) => l())
})

export const getSettings = () => current

/** Notifier ce changement de la PR : type de changement coché, et PR non brouillon si `notifyDrafts` est décoché. */
export const shouldNotify = (
  s: Settings,
  pr: { draft: boolean },
  kind: keyof Settings["notify"],
) => s.notify[kind] && (s.notifyDrafts || !pr.draft)

export type SettingsPatch = Partial<Omit<Settings, "notify">> & {
  notify?: Partial<Settings["notify"]>
}

export const applyPatch = (s: Settings, patch: SettingsPatch): Settings => ({
  ...s,
  ...patch,
  notify: { ...s.notify, ...patch.notify },
})

export function updateSettings(patch: SettingsPatch) {
  current = applyPatch(current, patch)
  // envoi recalculé sur les réglages partagés relus juste avant : un champ changé dans l'autre fenêtre est gardé
  saveItem(KEY, JSON.stringify(current), (remote) =>
    JSON.stringify(applyPatch(parseSettings(remote), patch)),
  )
  listeners.forEach((l) => l())
}

/** Remet les réglages par défaut, sauf la langue et le serveur MCP (son socket reste ouvert). */
export function resetSettings() {
  updateSettings({
    ...DEFAULT_SETTINGS,
    lang: current.lang,
    mcpEnabled: current.mcpEnabled,
  })
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
