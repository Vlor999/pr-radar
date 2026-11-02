import { useMemo, useSyncExternalStore } from "react"

// extensions : chargé aussi par node --test
import { matchRecipients, type Reviewer } from "./reviewers.ts"
import { fold } from "./settings-search.ts"
import { onPulled, saveItem } from "./sync.ts"
import type { SlackRecipient } from "./types.ts"

/**
 * Comptes de forge liés à un contact Slack (DM 1:1), 1:N : un contact peut avoir plusieurs comptes GitHub,
 * et plus tard GitLab (`provider`, pas de migration à prévoir). Liens manuels (réglages) ou automatiques
 * (rapprochement par nom, `matchRecipients`) ; un lien automatique retiré devient une exclusion explicite.
 */

const KEY = "pr-radar:slack-github"

export type Provider = "github"

/** `account` : compte PR Radar du lien quand plusieurs sont connectés (absent : tous) ; `id` : nœud GitHub,
 * nécessaire pour demander une review. */
export type LinkedAccount = {
  provider: Provider
  login: string
  account?: string
  id?: string
}

/** Liens d'un contact : ajoutés à la main, et rapprochements automatiques écartés. */
export type ContactLinks = {
  manual: LinkedAccount[]
  excluded: LinkedAccount[]
}

/** Par contact : `<id d'équipe Slack>:<id d'utilisateur Slack>`. */
export type SlackGithubMap = Record<string, ContactLinks>

export type ResolvedLink = LinkedAccount & { origin: "manual" | "auto" }

export const contactKey = (team: string, user: string) => `${team}:${user}`

/** Même compte : forge et login (casse ignorée) ; un compte PR Radar absent d'un côté vaut pour tous. */
const sameAccount = (a: LinkedAccount, b: LinkedAccount) =>
  a.provider === b.provider &&
  a.login.toLowerCase() === b.login.toLowerCase() &&
  (!a.account || !b.account || a.account === b.account)

const appliesTo = (l: LinkedAccount, account?: string) =>
  !l.account || !account || l.account === account

const isLink = (v: unknown): v is LinkedAccount => {
  const l = v as Partial<LinkedAccount> | null
  return l?.provider === "github" && typeof l.login === "string"
}

/** Table lue du stockage ; absente ou invalide : vide, entrées invalides ignorées. */
export function parseMap(raw: string | null): SlackGithubMap {
  try {
    const v: unknown = JSON.parse(raw ?? "{}")
    if (!v || typeof v !== "object" || Array.isArray(v)) return {}
    const out: SlackGithubMap = {}
    for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
      const c = e as Partial<Record<keyof ContactLinks, unknown>> | null
      const list = (x: unknown) => (Array.isArray(x) ? x.filter(isLink) : [])
      out[k] = { manual: list(c?.manual), excluded: list(c?.excluded) }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Liens affichés d'un contact : les manuels, puis les automatiques non exclus des comptes PR Radar sans lien
 * manuel (un lien manuel sans compte précisé vaut pour tous). Même règle que `dmReviewers` : un compte
 * confirmé ou ajouté à la main masque les autres correspondances automatiques de ce contact sur ce compte.
 */
export function resolveLinks(
  entry: ContactLinks | undefined,
  auto: LinkedAccount[],
): ResolvedLink[] {
  const manual = entry?.manual ?? []
  return [
    ...manual.map((l): ResolvedLink => ({ ...l, origin: "manual" })),
    ...auto
      .filter(
        (a) =>
          !manual.some((m) => appliesTo(m, a.account)) &&
          !entry?.excluded.some((x) => sameAccount(x, a)),
      )
      .map((l): ResolvedLink => ({ ...l, origin: "auto" })),
  ]
}

/** Lien ajouté à la main : sans doublon, et retiré des exclusions. */
export function withLink(
  map: SlackGithubMap,
  key: string,
  link: LinkedAccount,
): SlackGithubMap {
  const e = map[key] ?? { manual: [], excluded: [] }
  return {
    ...map,
    [key]: {
      manual: [...e.manual.filter((l) => !sameAccount(l, link)), link],
      excluded: e.excluded.filter((l) => !sameAccount(l, link)),
    },
  }
}

/** Correspondance automatique confirmée : elle devient un lien manuel (et l'emporte, voir `resolveLinks`). */
export const withConfirmed = (
  map: SlackGithubMap,
  key: string,
  link: ResolvedLink,
): SlackGithubMap => {
  const { origin: _, ...plain } = link
  return withLink(map, key, plain)
}

/** Lien retiré : manuel, il quitte la liste ; automatique, il devient une exclusion (ne revient pas). */
export function withoutLink(
  map: SlackGithubMap,
  key: string,
  link: ResolvedLink,
): SlackGithubMap {
  const e = map[key] ?? { manual: [], excluded: [] }
  const { origin: _, ...plain } = link
  return {
    ...map,
    [key]:
      link.origin === "manual"
        ? { ...e, manual: e.manual.filter((l) => !sameAccount(l, plain)) }
        : {
            ...e,
            excluded: [
              ...e.excluded.filter((l) => !sameAccount(l, plain)),
              plain,
            ],
          },
  }
}

/* ---------- Table des réglages : statut, recherche, filtres ---------- */

/** `todo` : au moins une correspondance par nom à confirmer ; `linked` : liens manuels seulement ; `none` : aucun. */
export type ContactStatus = "todo" | "linked" | "none"
export type ContactFilter = "all" | ContactStatus

/** Contact d'un DM 1:1 affiché dans la table, avec ses liens résolus. */
export type ContactRow = {
  user: string
  name: string
  names: string[]
  handle?: string
  links: ResolvedLink[]
}

export const contactStatus = (links: ResolvedLink[]): ContactStatus =>
  links.some((l) => l.origin === "auto")
    ? "todo"
    : links.length
      ? "linked"
      : "none"

export function contactCounts(
  rows: Pick<ContactRow, "links">[],
): Record<ContactStatus, number> {
  const out = { todo: 0, linked: 0, none: 0 }
  for (const r of rows) out[contactStatus(r.links)]++
  return out
}

/** Recherche : nom affiché, noms Slack, identifiant (`@` initial ignoré) et logins liés, casse et accents ignorés. */
export const matchesContact = (row: ContactRow, query: string) => {
  const q = fold(query.trim().replace(/^@/, ""))
  return (
    !q ||
    [row.name, ...row.names, row.handle ?? "", ...row.links.map((l) => l.login)]
      .map(fold)
      .some((s) => s.includes(q))
  )
}

export const filterContacts = <R extends ContactRow>(
  rows: R[],
  query: string,
  filter: ContactFilter,
) =>
  rows.filter(
    (r) =>
      (filter === "all" || contactStatus(r.links) === filter) &&
      matchesContact(r, query),
  )

/** Liens manuels d'un contact utilisables sur une PR du compte `account` (id GitHub connu). */
const manualFor = (entry: ContactLinks | undefined, account?: string) =>
  (entry?.manual ?? []).filter(
    (l) => l.provider === "github" && !!l.id && appliesTo(l, account),
  )

/** Destinataires sans lien manuel sur ce compte : seuls eux sont rapprochés par nom (recherche GitHub). */
export const lookupRecipients = (
  recipients: SlackRecipient[],
  map: SlackGithubMap,
  team: string | undefined,
  account?: string,
) =>
  recipients.filter(
    (r) =>
      !manualFor(team ? map[contactKey(team, r.id)] : undefined, account)
        .length,
  )

/**
 * Reviewers proposés pour les destinataires de mes DM sur une PR du compte `account` : liens manuels d'abord
 * (ils l'emportent sur le rapprochement), sinon rapprochement par nom parmi `users`, moins les exclusions.
 * Sans doublon de login.
 */
export function dmReviewers(
  recipients: SlackRecipient[],
  map: SlackGithubMap,
  team: string | undefined,
  account: string | undefined,
  users: Reviewer[],
): Reviewer[] {
  const out = new Map<string, Reviewer>()
  for (const r of recipients) {
    const entry = team ? map[contactKey(team, r.id)] : undefined
    const manual = manualFor(entry, account)
    const found: Reviewer[] = manual.length
      ? manual.map((l) => ({ login: l.login, id: l.id!, name: null }))
      : matchRecipients([r], users).filter(
          (u) =>
            !entry?.excluded.some((x) =>
              sameAccount(x, { provider: "github", login: u.login, account }),
            ),
        )
    for (const u of found)
      if (!out.has(u.login.toLowerCase())) out.set(u.login.toLowerCase(), u)
  }
  return [...out.values()]
}

/* ---------- Store : localStorage, partagé avec l'autre fenêtre (sync) ---------- */

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

onPulled((keys) => {
  if (keys.includes(KEY)) emit()
})

const write = (map: SlackGithubMap) => {
  saveItem(KEY, JSON.stringify(map))
  emit()
}

export function useSlackGithubMap(): SlackGithubMap {
  const raw = useSyncExternalStore(subscribe, read)
  return useMemo(() => parseMap(raw), [raw])
}

/** Lie à la main un compte GitHub au contact Slack `user` de l'équipe `team`. */
export const linkAccount = (team: string, user: string, link: LinkedAccount) =>
  write(withLink(parseMap(read()), contactKey(team, user), link))

/** Confirme une correspondance automatique affichée : lien manuel. */
export const confirmLink = (team: string, user: string, link: ResolvedLink) =>
  write(withConfirmed(parseMap(read()), contactKey(team, user), link))

/** Retire un lien affiché (manuel : supprimé ; automatique : exclu). */
export const unlinkAccount = (team: string, user: string, link: ResolvedLink) =>
  write(withoutLink(parseMap(read()), contactKey(team, user), link))
