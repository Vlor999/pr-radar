import { getSettings, useSettings } from "./settings"

export type Lang = "fr" | "en"

/** Textes d'un fichier dans les deux langues : `en` doit avoir exactement les clés de `fr`. */
export const strings = <T>(fr: T, en: NoInfer<T>) => ({ fr, en })

type Strings<T> = { fr: T; en: T }

/** Langue choisie, sinon celle du système (avant le choix au premier lancement). */
export const currentLang = (lang = getSettings().lang): Lang =>
  lang ?? (navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en")

/** Locale pour `toLocale*String`, lue au rendu. */
export const locale = () => (currentLang() === "fr" ? "fr-FR" : "en-US")

/** Textes hors React (erreurs, notifications). */
export const pick = <T>(s: Strings<T>): T => s[currentLang()]

/** Textes d'un composant, re-rendu au changement de langue. */
export const useStrings = <T>(s: Strings<T>): T =>
  s[currentLang(useSettings().lang)]
