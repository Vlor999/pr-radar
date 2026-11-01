import {
  FEEDBACK_DISCUSSION_CATEGORY,
  GITHUB_PREFILL_MAX_URL_LENGTH,
  REPO_URL,
} from "./constants.ts" // extension : chargé aussi par node --test
import { strings, type Lang } from "./i18n.ts"

// Retours préremplis sur GitHub : l'app ouvre une adresse, l'utilisateur écrit et publie dans son
// navigateur. Aucun appel d'API, aucun jeton, ni repo ni login dans le texte.

const S = strings(
  {
    context: "Contexte",
    version: "Version",
    os: "Système",
    runtime: "Interface",
    desktop: "app de bureau",
    web: "version web",
    unknown: "inconnu",
    truncated: "_[texte tronqué : adresse trop longue]_",
    feedbackTitle: "Avis sur PR Radar",
    feedbackPlaceholder:
      "<!-- Votre idée, question ou remarque. Le contexte ci-dessous aide à la comprendre. -->",
  },
  {
    context: "Context",
    version: "Version",
    os: "OS",
    runtime: "Interface",
    desktop: "desktop app",
    web: "web version",
    unknown: "unknown",
    truncated: "_[text truncated: address too long]_",
    feedbackTitle: "Feedback on PR Radar",
    feedbackPlaceholder:
      "<!-- Your idea, question or remark. The context below helps understand it. -->",
  },
)

/** Ce que l'app sait d'elle-même, sans rien d'identifiant. */
export type ReportContext = {
  /** null : inconnue (version web, sans IPC Tauri) */
  version: string | null
  /** null : système non reconnu */
  os: string | null
  web: boolean
}

/** Système d'après l'user agent de la webview (macOS, Windows, Linux), sinon null. */
export function osName(userAgent: string): string | null {
  if (/iPhone|iPad|Android/.test(userAgent)) return null
  if (/Macintosh|Mac OS X/.test(userAgent)) return "macOS"
  if (/Windows/.test(userAgent)) return "Windows"
  if (/Linux|X11/.test(userAgent)) return "Linux"
  return null
}

/** Bloc « Contexte » en Markdown, ajouté sous le message. */
export function contextBlock(ctx: ReportContext, lang: Lang): string {
  const t = S[lang]
  return [
    "---",
    `### ${t.context}`,
    `- ${t.version}: ${ctx.version ?? t.unknown}`,
    `- ${t.os}: ${ctx.os ?? t.unknown}`,
    `- ${t.runtime}: ${ctx.web ? t.web : t.desktop}`,
  ].join("\n")
}

/** Texte prérempli : `body` est tronqué si l'adresse est trop longue, `footer` (contexte) est gardé entier. */
export type Prefill = { title: string; body: string; footer?: string }

const encode = (params: [string, string][]) =>
  params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")

/**
 * Adresse `base?params&title=…&body=…` d'au plus `maxLength` caractères : le corps est coupé
 * (sans casser un caractère) et marqué comme tronqué. Le titre et `params` sont supposés courts.
 */
export function prefillUrl(
  base: string,
  params: [string, string][],
  { title, body, footer }: Prefill,
  lang: Lang,
  maxLength = GITHUB_PREFILL_MAX_URL_LENGTH,
): string {
  const url = (text: string) =>
    `${base}?${encode([
      ...params,
      ["title", title],
      ["body", footer ? `${text}\n\n${footer}` : text],
    ])}`
  const full = url(body)
  if (full.length <= maxLength) return full
  const chars = Array.from(body)
  const cut = (n: number) =>
    url(`${chars.slice(0, n).join("")}\n\n${S[lang].truncated}`)
  // plus grand préfixe qui tient (la longueur croît avec n)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (cut(mid).length <= maxLength) lo = mid
    else hi = mid - 1
  }
  return cut(lo)
}

/** Nouvelle discussion préremplie sur le dépôt de l'app. */
export const newDiscussionUrl = (
  category: string,
  prefill: Prefill,
  lang: Lang,
) =>
  prefillUrl(
    `${REPO_URL}/discussions/new`,
    [["category", category]],
    prefill,
    lang,
  )

/** Nouvelle issue préremplie (modèle `.github/ISSUE_TEMPLATE/<template>` et labels optionnels). */
export const newIssueUrl = (
  prefill: Prefill,
  lang: Lang,
  { template, labels = [] }: { template?: string; labels?: string[] } = {},
) =>
  prefillUrl(
    `${REPO_URL}/issues/new`,
    [
      ...(template ? [["template", template] as [string, string]] : []),
      ...(labels.length
        ? [["labels", labels.join(",")] as [string, string]]
        : []),
    ],
    prefill,
    lang,
  )

/** « Envoyer un avis » : discussion préremplie, message à écrire dans le navigateur, contexte en dessous. */
export const feedbackUrl = (ctx: ReportContext, lang: Lang, message = "") =>
  newDiscussionUrl(
    FEEDBACK_DISCUSSION_CATEGORY,
    {
      title: S[lang].feedbackTitle,
      body: message || S[lang].feedbackPlaceholder,
      footer: contextBlock(ctx, lang),
    },
    lang,
  )
