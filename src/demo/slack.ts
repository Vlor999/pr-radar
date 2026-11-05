// Démo navigateur : même API que src/lib/slack.ts, workspace fictif « acme », aucun appel réseau.
import { useSyncExternalStore } from "react"

import { HOUR_MS } from "@/lib/quiet"
import { updateSettings, useSettings } from "@/lib/settings"
import type { Reviewer } from "@/lib/reviewers"
import type { Pr, SlackConversation, SlackMention } from "@/lib/types"

type Team = { id: string; name: string }
export type SlackState = { team: Team | null; expired: boolean }

/** latence simulée de la connexion OAuth */
const CONNECT_MS = 800
/** une PR toutes les 3 s, comme THROTTLE_MS de src/lib/slack.ts */
const THROTTLE_MS = 3_000
/** prochaine relecture des mentions, comme CACHE_TTL_MS de src/lib/slack.ts */
const CACHE_TTL_MS = 10 * 60_000
/** latence simulée de `conversations.list` : lignes fantômes de la table Slack → GitHub à la 1re ouverture */
const LIST_MS = 900
/** noms des DM lus après la liste (users.info) : ils s'affichent sans rouvrir les réglages */
const NAMES_MS = 1_500
/** table Slack → GitHub stockée (comme KEY de src/lib/slack-github-map.ts) */
const MAP_KEY = "pr-radar:slack-github"

const ACME: Team = { id: "T0ACME", name: "acme" }
let state: SlackState = { team: ACME, expired: false }
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const set = (next: SlackState) => {
  state = next
  listeners.forEach((l) => l())
}

export const useSlack = () => useSyncExternalStore(subscribe, () => state)

export async function connectSlack() {
  await new Promise((r) => setTimeout(r, CONNECT_MS))
  set({ team: ACME, expired: false })
}

export async function disconnectSlack() {
  updateSettings({ slackAll: false, slackChannels: [] })
  set({ team: null, expired: false })
}

/** ~50 contacts de DM fictifs pour la table Slack → GitHub des réglages : défilement, recherche, filtres */
const FIRST = [
  "Bruno",
  "Chloé",
  "David",
  "Emma",
  "Farid",
  "Gaëlle",
  "Hugo",
  "Inès",
  "Jules",
  "Karim",
  "Léa",
  "Marc",
  "Omar",
  "Pauline",
  "Quentin",
  "Rose",
  "Samir",
  "Théo",
  "Ursula",
  "Victor",
  "Wendy",
  "Xavier",
  "Yasmine",
  "Zoé",
  "Adrien",
  "Bérénice",
  "Cyril",
  "Diane",
  "Étienne",
  "Fanny",
  "Gilles",
  "Hélène",
  "Ilyes",
  "Jade",
  "Kevin",
  "Lucie",
  "Maxime",
  "Noémie",
  "Olivier",
  "Prune",
  "Raphaël",
  "Sophie",
  "Tom",
  "Valentin",
  "Agathe",
  "Baptiste",
]
const LAST = [
  "Bernard",
  "Dubois",
  "Thomas",
  "Robert",
  "Richard",
  "Durand",
  "Leroy",
  "Moreau",
  "Simon",
  "Lefebvre",
  "Michel",
  "Garcia",
  "Bertrand",
  "Vincent",
  "Fournier",
  "Morel",
  "Girard",
  "André",
  "Mercier",
  "Dupont",
  "Lambert",
  "Bonnet",
  "François",
  "Martinez",
  "Legrand",
  "Garnier",
  "Faure",
  "Rousseau",
  "Blanc",
  "Guérin",
  "Muller",
  "Henry",
  "Roussel",
  "Nicolas",
  "Perrin",
  "Morin",
  "Mathieu",
  "Clément",
  "Gauthier",
  "Dumont",
  "Lopez",
  "Fontaine",
  "Chevalier",
  "Robin",
  "Masson",
  "Lemoine",
]
const ascii = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

type DemoContact = { id: string; names: string[]; handle: string }

/** noms Slack des destinataires de DM 1:1 (users.info : nom complet, nom d'affichage, identifiant) */
const CONTACTS: DemoContact[] = [
  { id: "D1", names: ["Alice Martin", "Alice"], handle: "alice.martin" },
  { id: "D2", names: ["Erin Laurent", "Erin"], handle: "erin" },
  // deux comptes GitHub trouvés par le nom (frank, fpetit) ; aucun pour Nina
  { id: "D3", names: ["Frank Petit", "Frank P."], handle: "frank.petit" },
  { id: "D4", names: ["Nina Roux", "Nina"], handle: "nina" },
  ...FIRST.map((f, i) => ({
    id: `D${i + 10}`,
    names: [`${f} ${LAST[i]}`, f],
    handle: `${ascii(f)}.${ascii(LAST[i])}`,
  })),
]
const DM_NAMES: Record<string, string[]> = Object.fromEntries(
  CONTACTS.map((c) => [c.id, [...c.names, c.handle]]),
)
const ghLogin = (c: DemoContact) => c.handle.replace(".", "-")

/**
 * Utilisateurs GitHub assignables qui portent le nom d'un contact (rapprochés par nom, « à confirmer ») :
 * un contact sur trois, deux comptes pour certains. Repris par `searchAssignable` de src/demo/github.ts.
 */
export const DEMO_DM_USERS: Reviewer[] = CONTACTS.slice(4).flatMap((c, i) =>
  i % 3 === 0
    ? [
        { login: ghLogin(c), id: `U_${ghLogin(c)}`, name: c.names[0] },
        ...(i % 9 === 0
          ? [
              {
                login: `${ghLogin(c)}-acme`,
                id: `U_${ghLogin(c)}-acme`,
                name: c.names[0],
              },
            ]
          : []),
      ]
    : [],
)

// liens ajoutés à la main (« liés ») : un contact sur quatre, deux comptes pour Hugo ; ajoutés s'ils manquent
try {
  const map = JSON.parse(localStorage.getItem(MAP_KEY) ?? "{}") as Record<
    string,
    unknown
  >
  const link = (login: string) => ({
    provider: "github",
    login,
    id: `U_${login}`,
  })
  CONTACTS.slice(4).forEach((c, i) => {
    const key = `${ACME.id}:U_${c.id}`
    const hugo = c.names[1] === "Hugo"
    if ((i % 4 !== 1 && !hugo) || key in map) return
    map[key] = {
      manual: [link(ghLogin(c)), ...(hugo ? [link("hugo-ext")] : [])],
      excluded: [],
    }
  })
  localStorage.setItem(MAP_KEY, JSON.stringify(map))
} catch {}

const CONVS: SlackConversation[] = [
  { id: "C1", name: "dev", kind: "public" },
  { id: "C2", name: "releases", kind: "public" },
  { id: "G1", name: "checkout-squad", kind: "private" },
  // filtres du choix des conversations : channels publics et privés, DM de groupe
  ...[
    "general",
    "random",
    "design",
    "frontend",
    "backend",
    "incidents",
    "deploys",
    "ci-alerts",
    "api-guild",
    "product",
    "support",
    "standup",
  ].map((name, i): SlackConversation => ({
    id: `C${i + 3}`,
    name,
    kind: "public",
  })),
  ...["security", "leads", "payments-core"].map(
    (name, i): SlackConversation => ({
      id: `G${i + 2}`,
      name,
      kind: "private",
    }),
  ),
  { id: "M2", name: "bruno, chloé, david", kind: "mpim" },
  { id: "M3", name: "emma, farid", kind: "mpim" },
  { id: "M4", name: "léa, marc, omar", kind: "mpim" },
  ...CONTACTS.map((c): SlackConversation => ({
    id: c.id,
    name: c.names[0],
    kind: "im",
  })),
  { id: "M1", name: "alice, bob", kind: "mpim" },
]

/** liste déjà lue pendant la session : la table s'affiche aussitôt, comme avec le cache de src/lib/slack.ts */
let listed: SlackConversation[] | null = null

export const cachedConversations = () => listed

/** DM d'abord avec l'id du destinataire, puis nommés (`onNamed`) après NAMES_MS, comme users.info */
export const listConversations = async (
  onNamed: (list: SlackConversation[]) => void,
): Promise<SlackConversation[]> => {
  await new Promise((r) => setTimeout(r, LIST_MS))
  if (listed) return listed
  setTimeout(() => onNamed((listed = named())), NAMES_MS)
  return CONVS.map((c) =>
    c.kind === "im"
      ? {
          ...c,
          name: `U_${c.id}`,
          contact: { user: `U_${c.id}`, names: [] },
        }
      : c,
  )
}

const named = () =>
  CONVS.map((c) =>
    c.kind === "im"
      ? {
          ...c,
          contact: {
            user: `U_${c.id}`,
            names: DM_NAMES[c.id] ?? [],
            handle: CONTACTS.find((x) => x.id === c.id)?.handle,
          },
        }
      : c,
  )

const ago = (h: number) => new Date(Date.now() - h * HOUR_MS).toISOString()
const at = (
  channelId: string,
  author: string,
  text: string,
  h: number,
): SlackMention => {
  const c = CONVS.find((c) => c.id === channelId)!
  return {
    author,
    channelId,
    where:
      c.kind === "im" || c.kind === "mpim" ? `DM · ${c.name}` : `#${c.name}`,
    at: ago(h),
    text,
    permalink: `https://acme.slack.com/archives/${channelId}/p${h}`,
    // DM 1:1 que j'ai envoyé : son destinataire est proposé en reviewer
    ...(c.kind === "im" &&
      author === "me" && {
        recipient: { id: `U_${channelId}`, names: DM_NAMES[channelId] ?? [] },
      }),
  }
}

const MENTIONS: Record<string, SlackMention[]> = {
  "https://github.com/acme/web/pull/412": [
    at(
      "C1",
      "me",
      "Refonte du paiement prête pour review :\n• <https://github.com/acme/web/pull/412|acme/web#412>\n• maquettes : <https://figma.com/file/acme-checkout>\ncc <@U1|Alice Martin> <#C2|releases>",
      20,
    ),
    at(
      "M1",
      "alice",
      "J'ai approuvé <https://github.com/acme/web/pull/412>, tu peux merger",
      4,
    ),
  ],
  // discussion ouverte + messages Slack + PR stackée dessous (#418) : rail et colonnes ensemble
  "https://github.com/acme/web/pull/415": [
    at(
      "G1",
      "bob",
      "Validation des adresses : <https://github.com/acme/web/pull/415|acme/web#415>\nquelqu'un pour relire ?",
      6,
    ),
    at(
      "D1",
      "alice",
      "Je regarde <https://github.com/acme/web/pull/415> demain",
      2,
    ),
  ],
  "https://github.com/acme/api/pull/88": [
    at(
      "D1",
      "me",
      "Tu peux relire <https://github.com/acme/api/pull/88|acme/api#88> ?",
      28,
    ),
    // colonne Slack plus haute que carte + discussion
    at(
      "C2",
      "bob",
      "Changements demandés sur <https://github.com/acme/api/pull/88|acme/api#88> :\n• curseur opaque\n• limite max à 100\n• tests de pagination",
      26,
    ),
    at(
      "C1",
      "me",
      "Corrigé, <https://github.com/acme/api/pull/88> prête pour une 2e passe",
      20,
    ),
    // DM à Erin : « erin-l » sur GitHub, proposée en tête du popover « Ajouter un reviewer »
    at(
      "D2",
      "me",
      "Salut Erin, tu aurais un moment pour relire <https://github.com/acme/api/pull/88|acme/api#88> ?",
      18,
    ),
    at(
      "M1",
      "alice",
      "Je relance la review de <https://github.com/acme/api/pull/88> cet après-midi",
      8,
    ),
    at(
      "D1",
      "alice",
      "<https://github.com/acme/api/pull/88> : ok pour moi après tes derniers commits",
      3,
    ),
  ],
  // vue Fil : PR ouverte de l'arbre (src/demo/github.ts, `PRS`) ; les PR de la lecture légère n'ont pas de points Slack
  "https://github.com/acme/api/pull/141": [
    at(
      "C1",
      "me",
      "Re-review possible sur la proration ? <https://github.com/acme/api/pull/141>",
      12 * 24,
    ),
    at(
      "D1",
      "me",
      "Je relance sur <https://github.com/acme/api/pull/141|acme/api#141>, il bloque la facturation de décembre",
      5 * 24 + 2,
    ),
  ],
  "https://github.com/globex/billing/pull/7": [
    at("G1", "bob", "Qui peut relire l'export CSV ? globex/billing#7", 50),
  ],
}

export function refreshMentions(_prs: Pr[]) {}

export type SlackProgress = {
  running: boolean
  done: number
  total: number
  known: number
  nextAt: number | null
  completedAt: number | null
}
const KNOWN = Object.keys(MENTIONS).length
let progress: SlackProgress = {
  running: false,
  done: 0,
  total: 0,
  known: KNOWN,
  nextAt: Date.now() + 7 * 60_000,
  completedAt: null,
}
export const useSlackProgress = () =>
  useSyncExternalStore(subscribe, () => progress)

/** File simulée : une PR toutes les 3 s, comme dans l'app. */
export function forceRefreshMentions() {
  const tick = (done: number) => {
    const running = done < KNOWN
    progress = {
      ...progress,
      running,
      done,
      total: KNOWN,
      ...(!running && {
        nextAt: Date.now() + CACHE_TTL_MS,
        completedAt: Date.now(),
      }),
    }
    listeners.forEach((l) => l())
    if (running) setTimeout(() => tick(done + 1), THROTTLE_MS)
  }
  if (!progress.running) tick(0)
}

const NONE: SlackMention[] = []

export function useMentions(url: string): SlackMention[] {
  const { slackAll, slackChannels } = useSettings()
  const { team } = useSlack()
  const list = MENTIONS[url] ?? NONE
  if (!team) return NONE
  return slackAll
    ? list
    : list.filter((m) => slackChannels.includes(m.channelId))
}

export function useMentionLookup(): (url: string) => SlackMention[] {
  const { slackAll, slackChannels } = useSettings()
  const { team } = useSlack()
  return (url: string) => {
    const list = MENTIONS[url] ?? NONE
    if (!team) return NONE
    return slackAll
      ? list
      : list.filter((m) => slackChannels.includes(m.channelId))
  }
}
