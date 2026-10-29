import { useSyncExternalStore } from "react"

import type { Lang } from "./i18n"
import type { Who } from "./review"
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
}

const KEY = "pr-radar:settings"

/** Fréquence enregistrée : "auto" ou des minutes entières >= 0 ; sinon la valeur par défaut. */
export const refreshMinutesOf = (v: unknown): Settings["refreshMinutes"] =>
  v === "auto" || (Number.isInteger(v) && (v as number) >= 0)
    ? (v as Settings["refreshMinutes"])
    : DEFAULT_SETTINGS.refreshMinutes
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
      reviewWho: ["all", "me", "team"].includes(saved.reviewWho ?? "")
        ? saved.reviewWho!
        : "all",
      reviewHideApproved: saved.reviewHideApproved === true,
      refreshMinutes: refreshMinutesOf(saved.refreshMinutes),
    }
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

export function updateSettings(patch: SettingsPatch) {
  current = {
    ...current,
    ...patch,
    notify: { ...current.notify, ...patch.notify },
  }
  saveItem(KEY, JSON.stringify(current))
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
