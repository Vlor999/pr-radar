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
/** fenêtre de ce plafond */
export const WEBVIEW_ERROR_WINDOW_MS = 60_000
/** anonymisation : valeur plus courte jamais remplacée (abîmerait le texte, n'identifie rien seule) */
export const CRASH_MIN_SECRET_CHARS = 3
/** `owner/name` dans une adresse d'API (`/repos/owner/name`) ou de github.com */
export const CRASH_REPO_IN_URL =
  /(?:\/repos\/|github\.com\/(?!(?:repos|orgs|users)\/))([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g
/** organisation ou utilisateur dans une adresse d'API (`/orgs/acme`, `/users/jdoe`) */
export const CRASH_OWNER_IN_URL = /\/(?:orgs|users)\/([A-Za-z0-9_.-]+)/g
/**
 * dossier personnel dans un chemin (macOS, Linux, Windows) : remplacé par `~`. Le nom s'arrête au
 * séparateur, à un guillemet ou à la fin de ligne, pas à une espace (`C:\Users\John Smith\…`) : sans
 * séparateur après, la suite de la ligne part avec (plutôt trop masquer que laisser un nom).
 */
export const CRASH_HOME_DIRS = [
  /\/(?:Users|home)\/[^/"'`:\r\n]+/g,
  /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/"'`\r\n]+/gi,
]
/** adresse e-mail */
export const CRASH_EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

/* ---------- Actualisation des PR (github.ts, delta.ts, pr-query.ts) ---------- */

/** au-delà, une actualisation automatique relit toutes les PR en entier au lieu des seules PR changées */
export const FULL_REFRESH_MAX_AGE_MS = 10 * 60_000
/** PR par page du sondage : 30 coûte 1 point, 50 en coûte 2 (le coût GraphQL suit les bornes demandées) */
export const PROBE_PAGE_SIZE = 30
/** ids par lecture complète `nodes(ids:)` (GitHub : 100 au plus) ; 20 = taille d'une page de l'ancienne recherche complète */
export const NODES_PER_QUERY = 20

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

/* ---------- Outils MCP `get_checks` et `get_merged` (mcp-data.ts) ---------- */

/** nom donné aux statuts de commit (CI hors Actions), boîte sans workflow de la vue CI */
export const MCP_STATUSES_NAME = "commit statuses"
/** arguments acceptés par `get_merged` (mêmes que `check_merged_args` du shim) */
export const MCP_MERGED_ARGS = new Set(["from", "to", "repo"])
/** forme d'un jour `YYYY-MM-DD`, chiffres ASCII seulement (`\d` sans drapeau `u`) */
export const MCP_DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/
/** rang du centile `p90LeadTime` (rang le plus proche) */
export const MCP_LEAD_TIME_PERCENTILE = 0.9

/* ---------- Prompts MCP (settings/mcp.tsx) ---------- */

/** Prompts servis par le shim (`prompts()` de `src-tauri/src/mcp.rs`) : nom, arguments affichés, clé du texte. Liste vérifiée par `mcp-prompts.json`. */
export const MCP_PROMPTS = [
  { name: "triage", args: "", key: "triage" },
  { name: "review-queue", args: "", key: "reviewQueue" },
  { name: "fix-ci", args: "url", key: "fixCi" },
  { name: "answer-threads", args: "url", key: "answerThreads" },
  { name: "standup", args: "repo?", key: "standup" },
] as const

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
