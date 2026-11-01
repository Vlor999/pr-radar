/** page de soutien du mainteneur (Buy Me a Coffee) */
export const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/Vlor999"

/* ---------- Retours sur GitHub (report.ts) ---------- */

/** dépôt de l'app : code source, issues et discussions */
export const REPO_URL = "https://github.com/Vlor999/pr-radar"
/** catégorie des discussions ouvertes par « Envoyer un avis » (slug GitHub) */
export const FEEDBACK_DISCUSSION_CATEGORY = "ideas"
/** longueur max. d'une adresse préremplie : au-delà, GitHub ou le navigateur la refusent */
export const GITHUB_PREFILL_MAX_URL_LENGTH = 8_000

/* ---------- Réglages ---------- */

/** durée du surlignage d'un réglage ouvert depuis la recherche */
export const SETTING_HIGHLIGHT_MS = 1_600

/* ---------- Recherche des réglages (settings-search.ts) ---------- */

/** poids d'un mot trouvé dans la description ou les mots-clés, par rapport au libellé */
export const SEARCH_REST_WEIGHT = 0.4
/** qualité d'un mot trouvé : mot entier > début de mot > ailleurs dans le texte > faute de frappe */
export const SEARCH_QUALITY = {
  word: 1,
  prefix: 0.9,
  inside: 0.8,
  typo1: 0.6,
  typo2: 0.45,
}
/** mots de la requête plus courts : pas de tolérance aux fautes (trop de faux positifs) */
export const SEARCH_FUZZY_MIN_LENGTH = 4
/** à partir de cette longueur, deux fautes tolérées au lieu d'une */
export const SEARCH_TWO_TYPOS_LENGTH = 8
