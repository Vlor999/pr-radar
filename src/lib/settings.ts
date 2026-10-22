import { useSyncExternalStore } from "react"

import type { Lang } from "./i18n"

/** Réglages de l'app, gardés dans la fenêtre (localStorage). Chaque clé a une valeur par défaut. */
export type Settings = {
  /** minutes entre deux actualisations automatiques ; 0 = manuelle */
  refreshMinutes: number
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
}

export const DEFAULT_SETTINGS: Settings = {
  refreshMinutes: 5,
  refreshOnFocus: true,
  notify: {
    approved: true,
    changesRequested: true,
    comments: true,
    ciFailed: true,
    reviewRequested: true,
  },
  defaultSort: "priority",
  staleDays: 5,
  mergedDays: 7,
  hiddenRepos: [],
  lang: null,
  slackAll: false,
  slackChannels: [],
}

const KEY = "pr-radar:settings"
const listeners = new Set<() => void>()

function read(): Settings {
  try {
    const saved = JSON.parse(
      localStorage.getItem(KEY) ?? "{}",
    ) as Partial<Settings>
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      notify: { ...DEFAULT_SETTINGS.notify, ...saved.notify },
      // valeur inconnue (édition à la main, version plus récente) : on repose la question
      lang: saved.lang === "fr" || saved.lang === "en" ? saved.lang : null,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

let current = read()

export const getSettings = () => current

export type SettingsPatch = Partial<Omit<Settings, "notify">> & {
  notify?: Partial<Settings["notify"]>
}

export function updateSettings(patch: SettingsPatch) {
  current = {
    ...current,
    ...patch,
    notify: { ...current.notify, ...patch.notify },
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {}
  listeners.forEach((l) => l())
}

/** Remet les réglages par défaut, sauf la langue. */
export function resetSettings() {
  updateSettings({ ...DEFAULT_SETTINGS, lang: current.lang })
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
