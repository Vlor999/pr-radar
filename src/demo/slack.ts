// Démo navigateur : même API que src/lib/slack.ts, workspace fictif « acme », aucun appel réseau.
import { useSyncExternalStore } from "react"

import { updateSettings, useSettings } from "@/lib/settings"
import type { Pr, SlackConversation, SlackMention } from "@/lib/types"

type Team = { id: string; name: string }
export type SlackState = { team: Team | null; expired: boolean }

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
  await new Promise((r) => setTimeout(r, 800))
  set({ team: ACME, expired: false })
}

export async function disconnectSlack() {
  updateSettings({ slackAll: false, slackChannels: [] })
  set({ team: null, expired: false })
}

const CONVS: SlackConversation[] = [
  { id: "C1", name: "dev", kind: "public" },
  { id: "C2", name: "releases", kind: "public" },
  { id: "G1", name: "checkout-squad", kind: "private" },
  { id: "D1", name: "Alice Martin", kind: "im" },
  { id: "M1", name: "alice, bob", kind: "mpim" },
]

export const listConversations = async (
  _onNamed: (list: SlackConversation[]) => void,
) => CONVS

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
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
  "https://github.com/globex/billing/pull/7": [
    at("G1", "bob", "Qui peut relire l'export CSV ? globex/billing#7", 50),
  ],
}

export function refreshMentions(_prs: Pr[]) {}

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
