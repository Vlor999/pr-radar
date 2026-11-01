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
    omitted: (n: number) =>
      `# ${n} ligne(s) plus ancienne(s) retirée(s) : adresse trop longue`,
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
    omitted: (n: number) => `# ${n} older line(s) removed: address too long`,
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

/** Plus long préfixe de `text` (marqué comme tronqué) dont l'adresse tient en `maxLength` caractères. */
function fit(
  url: (text: string) => string,
  text: string,
  lang: Lang,
  maxLength: number,
): string {
  const chars = Array.from(text)
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
  return full.length <= maxLength ? full : fit(url, body, lang, maxLength)
}

type IssueOptions = { template?: string; labels?: string[] }

const issueParams = ({ template, labels = [] }: IssueOptions) => [
  ...(template ? [["template", template] as [string, string]] : []),
  ...(labels.length ? [["labels", labels.join(",")] as [string, string]] : []),
]

/**
 * Formulaire d'issue (`.github/ISSUE_TEMPLATE/*.yml`) : GitHub préremplit ses champs texte par leur `id`
 * passé en paramètre d'adresse (`body` n'y est pas lu).
 */
export type IssueForm = {
  title: string
  fields: [id: string, value: string][]
  /** champ dont les lignes les plus anciennes sont retirées d'abord si l'adresse est trop longue (journal) */
  lines?: string
  /** champ coupé ensuite si ça ne suffit pas */
  cut?: string
}

/**
 * Nouvelle issue au formulaire prérempli, d'au plus `maxLength` caractères : lignes de `lines` retirées
 * depuis le début (une note dit combien), puis `cut` tronqué.
 */
export function issueFormUrl(
  { title, fields, lines, cut }: IssueForm,
  lang: Lang,
  options: IssueOptions = {},
  maxLength = GITHUB_PREFILL_MAX_URL_LENGTH,
): string {
  const url = (fs: [string, string][]) =>
    `${REPO_URL}/issues/new?${encode([...issueParams(options), ["title", title], ...fs])}`
  const set = (fs: [string, string][], id: string | undefined, v: string) =>
    fs.map(([k, x]): [string, string] => [k, k === id ? v : x])
  let current = fields
  if (url(current).length <= maxLength) return url(current)
  const all = (fields.find(([k]) => k === lines)?.[1] ?? "").split("\n")
  if (lines && all.length) {
    // n dernières lignes gardées, la note en tête
    const keep = (n: number) =>
      set(
        fields,
        lines,
        [S[lang].omitted(all.length - n), ...all.slice(all.length - n)].join(
          "\n",
        ),
      )
    let lo = 0
    let hi = all.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (url(keep(mid)).length <= maxLength) lo = mid
      else hi = mid - 1
    }
    current = keep(lo)
    if (url(current).length <= maxLength) return url(current)
  }
  const text = current.find(([k]) => k === cut)?.[1]
  if (text === undefined) return url(current)
  return fit((t) => url(set(current, cut, t)), text, lang, maxLength)
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
  options: IssueOptions = {},
) => prefillUrl(`${REPO_URL}/issues/new`, issueParams(options), prefill, lang)

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
