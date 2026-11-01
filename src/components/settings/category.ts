import type { SettingEntry } from "@/lib/settings-search"

// Une catégorie = un fichier de ce dossier : son dictionnaire `S`, son contenu (`<Nom>Category`) et
// ses lignes pour la recherche (`<nom>Entries`). Elle est branchée dans CATEGORY_VIEWS (settings-page.tsx).

/** Catégories des réglages, dans l'ordre du menu et des groupes de résultats de recherche. */
export const CATEGORIES = [
  "general",
  "accounts",
  "notifications",
  "prs",
  "mcp",
  "web",
  "advanced",
] as const

export type SettingsCategory = (typeof CATEGORIES)[number]

/** Réglage indexé par la recherche, dans la langue affichée ; l'id est celui de la ligne (`settingDomId`). */
export type SettingsEntry = SettingEntry<SettingsCategory> & {
  /** titre du groupe repliable qui contient la ligne (« Dépannage ») : affiché dans les résultats, ouvert au choix */
  group?: string
  /** masqué dans la version web (navigateur) : le réglage pilote l'app elle-même */
  desktopOnly?: boolean
}

/** État tenu par la page, passé au contenu de chaque catégorie. */
export type CategoryProps = {
  troubleshootOpen: boolean
  onTroubleshootOpen: (open: boolean) => void
}

export const words = (...parts: string[]) => parts.join(" ")
