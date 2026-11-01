import type { Harness } from "./harness.ts"

/** page de soutien du mainteneur (Buy Me a Coffee) */
export const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/Vlor999"

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
