/** Morceau d'un message Slack : texte brut, ou lien http(s) cliquable. */
export type SlackPart = { text: string; href?: string }

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")

/**
 * Message Slack (mrkdwn) en morceaux affichables, sans HTML : `<url|libellé>` et `<url>` → liens,
 * `<@U…|nom>` → @nom, `<#C…|nom>` → #nom, `<!here>` → @here. Sauts de ligne et puces gardés tels quels.
 */
export function slackParts(text: string): SlackPart[] {
  const parts: SlackPart[] = []
  let last = 0
  for (const m of text.matchAll(/<([^<>|]*)(?:\|([^<>]*))?>/g)) {
    if (m.index > last)
      parts.push({ text: unescape(text.slice(last, m.index)) })
    last = m.index + m[0].length
    const [target, label] = [unescape(m[1]), m[2] && unescape(m[2])]
    if (/^https?:\/\//i.test(target))
      parts.push({ text: label || target, href: target })
    else if (target.startsWith("@") || target.startsWith("#"))
      parts.push({ text: target[0] + (label || target.slice(1)) })
    else if (target.startsWith("!"))
      parts.push({ text: label || `@${target.slice(1).split("^")[0]}` })
    else parts.push({ text: label || target }) // mailto:, tel: … : libellé seul
  }
  if (last < text.length) parts.push({ text: unescape(text.slice(last)) })
  return parts
}
