import type { Harness } from "./harness.ts"
import type { ActionReason } from "./mcp-data.ts"

/** page de soutien du mainteneur (Buy Me a Coffee) */
export const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/Vlor999"

/* ---------- Retours sur GitHub (report.ts) ---------- */

/** dépôt de l'app : code source, issues et discussions */
export const REPO_URL = "https://github.com/Vlor999/pr-radar"
/** catégorie des discussions ouvertes par « Envoyer un avis » (slug GitHub) */
export const FEEDBACK_DISCUSSION_CATEGORY = "ideas"
/** longueur max. d'une adresse préremplie : au-delà, GitHub ou le navigateur la refusent */
export const GITHUB_PREFILL_MAX_URL_LENGTH = 8_000

/* ---------- Plantages (crash.ts, crash-data.ts, src-tauri/src/crash.rs) ---------- */

/** formulaire d'issue des plantages (.github/ISSUE_TEMPLATE/crash.yml) et son label */
export const CRASH_ISSUE_TEMPLATE = "crash.yml"
export const CRASH_ISSUE_LABEL = "crash"
/** avertissements et erreurs lus dans le journal pour le rapport, puis lignes gardées autour du plantage */
export const CRASH_LOG_READ_LIMIT = 500
export const CRASH_LOG_LINES = 30
/** erreurs de la webview journalisées : même message ignoré pendant ce délai, et au plus N par minute */
export const WEBVIEW_ERROR_DEDUPE_MS = 60_000
export const WEBVIEW_ERROR_MAX_PER_MIN = 10

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

/* ---------- Historique MCP (harness.ts) ---------- */

/**
 * `clientInfo.name` envoyé à l'`initialize` → harnais connu. Testés dans l'ordre :
 * le premier qui correspond gagne (`cursor-vscode` avant VS Code, `antigravity-client` avant Gemini).
 * Les proxys gardent le nom en préfixe (`claude-ai (via mcp-remote 0.1.9)`).
 */
export const HARNESS_PATTERNS: [Harness, RegExp][] = [
  // github.com/openai/codex : codex-rs/codex-mcp/src/rmcp_client.rs, `Implementation::new("codex-mcp-client", …)`
  ["codex", /codex/i],
  // canimcp.dev/client/antigravity-client
  ["antigravity", /antigravity/i],
  // canimcp.dev/client/cursor-vscode : `cursor-vscode`
  ["cursor", /cursor/i],
  // canimcp.dev/client/windsurf-client : `windsurf-client`
  ["windsurf", /windsurf/i],
  // aucune source publique : le nom de la marque (`devin`, Devin CLI ou Devin Desktop)
  ["devin", /\bdevin\b/i],
  // Claude Code envoie `{"name":"claude-code","title":"Claude Code"}` (log d'initialize, decodo.com/blog/claude-mcp-setup)
  ["claude-code", /claude[\s_-]?code/i],
  // Claude Desktop : `claude-ai` (log d'initialize, apollographql.com/tutorials/intro-mcp-graphql/05-connecting-claude)
  ["claude-desktop", /claude[\s_-]?(ai|desktop)\b|^claude$/i],
  // github.com/google-gemini/gemini-cli : packages/core/src/tools/mcp-client.ts, `name: 'gemini-cli-mcp-client'`
  ["gemini", /gemini/i],
  // github.com/zed-industries/zed : crates/context_server/src/context_server.rs, `name: "Zed"`
  ["zed", /\bzed\b/i],
  // github.com/microsoft/vscode : src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts,
  // `name: productService.nameLong` (« Visual Studio Code », « … - Insiders », « Code - OSS »)
  ["vscode", /visual studio code|\bvs ?code\b|^code - oss\b/i],
]

/* ---------- Outil MCP `get_attention` (mcp-data.ts) ---------- */

/** raisons servies en premier : quelqu'un attend ma review, ou ma CI est cassée */
export const ATTENTION_URGENT: ActionReason[] = ["reviewRequested", "ciFailing"]
/** en dessous, `age` en heures (`5h`) ; au-delà, en jours (`3d`) */
export const ATTENTION_AGE_HOURS_MAX = 48

/* ---------- Journal d'activité local (log.ts, src-tauri/src/log.rs) ---------- */

/** délai avant l'écriture d'un lot d'entrées (une commande par lot, pas par événement) */
export const LOG_FLUSH_MS = 2_000
/** lot plein : écrit sans attendre le délai */
export const LOG_BATCH_MAX = 100
/** entrées gardées en attente au plus (écriture en échec) : les plus anciennes tombent */
export const LOG_BUFFER_MAX = 1_000
/** purge des entrées trop anciennes : au lancement, puis à cet intervalle */
export const LOG_PURGE_INTERVAL_MS = 60 * 60_000
/** entrées affichées par le visualiseur des réglages */
export const LOG_VIEW_LIMIT = 200
/** chaîne journalisée tronquée au-delà (message d'erreur) */
export const LOG_STRING_MAX_CHARS = 300
/** conservation personnalisée : bornes et valeur par défaut, en jours */
export const LOG_CUSTOM_DAYS_MIN = 1
export const LOG_CUSTOM_DAYS_MAX = 365
export const LOG_CUSTOM_DAYS_DEFAULT = 30
export const DAY_MS = 86_400_000
