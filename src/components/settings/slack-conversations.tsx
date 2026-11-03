import { cn } from "cn"
import { Hash, Lock, Users } from "lucide-react"
import { useMemo, useState } from "react"

import {
  Count,
  LIST_ROW,
  ListFooter,
  ListToolbar,
  pulse,
  ScrollList,
  SlackAvatar,
} from "@/components/settings/slack-list"
import { Button } from "@/components/ui/button"
import {
  convCounts,
  filterConversations,
  withShown,
  type ConvFilter,
  type ConvType,
} from "@/lib/conversation-filter"
import { strings, useStrings } from "@/lib/i18n"
import { updateSettings, useSettings } from "@/lib/settings"
import type { SlackConversation } from "@/lib/types"

const TYPES: ConvType[] = ["channel", "im", "mpim"]
/** icône d'une conversation sans avatar (un DM 1:1 a celui du contact) */
const ICON = { public: Hash, private: Lock, mpim: Users }

const S = strings(
  {
    counts: {
      selected: (n: number) => `cochée${n > 1 ? "s" : ""}`,
      channel: (n: number) => `channel${n > 1 ? "s" : ""}`,
      im: (_n: number) => "DM",
      mpim: (_n: number) => "DM de groupe",
    },
    loading: "Chargement des conversations…",
    filters: {
      all: "Toutes",
      selected: "Cochées",
      channel: "Channels",
      im: "DM",
      mpim: "Groupes",
    },
    filterBy: "Filtrer les conversations",
    search: "Rechercher une conversation",
    searchPlaceholder: "#channel, nom ou @identifiant",
    noMatch: (q: string) => `Aucune conversation ne correspond à « ${q} ».`,
    selectShown: "Cocher les affichées",
    clearShown: "Décocher les affichées",
    kinds: {
      public: "public",
      private: "privé",
      im: "DM",
      mpim: "DM de groupe",
    },
  },
  {
    counts: {
      selected: (_n: number) => "selected",
      channel: (n: number) => `channel${n > 1 ? "s" : ""}`,
      im: (_n: number) => "DM",
      mpim: (n: number) => `group DM${n > 1 ? "s" : ""}`,
    },
    loading: "Loading conversations…",
    filters: {
      all: "All",
      selected: "Selected",
      channel: "Channels",
      im: "DM",
      mpim: "Groups",
    },
    filterBy: "Filter conversations",
    search: "Search conversations",
    searchPlaceholder: "#channel, name or @handle",
    noMatch: (q: string) => `No conversation matches “${q}”.`,
    selectShown: "Select shown",
    clearShown: "Clear shown",
    kinds: {
      public: "public",
      private: "private",
      im: "DM",
      mpim: "group DM",
    },
  },
)

/**
 * Conversations surveillées quand « toutes les conversations » est coupé : compteurs, recherche, filtres
 * par type, liste bornée (~8 lignes) dans l'ordre de Slack (une ligne cochée ne bouge pas). `convs`
 * absent : lignes fantômes. Pas de virtualisation : quelques centaines de lignes restent légères.
 */
export function ConversationPicker({
  convs,
}: {
  convs: SlackConversation[] | null
}) {
  const t = useStrings(S)
  const { slackChannels } = useSettings()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<ConvFilter>("all")
  const counts = useMemo(
    () => convs && convCounts(convs, slackChannels),
    [convs, slackChannels],
  )
  const shown =
    convs && filterConversations(convs, query, filter, slackChannels)
  const set = (ids: string[]) => updateSettings({ slackChannels: ids })
  const all = shown && withShown(slackChannels, shown, true)
  const none = shown && withShown(slackChannels, shown, false)

  return (
    <div className="-mx-4 border-t">
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-3 text-xs text-muted-foreground tabular-nums">
        {counts ? (
          (["selected", ...TYPES] as const)
            .filter((k) => k === "selected" || counts[k] > 0)
            .map((k) => (
              <Count key={k} n={counts[k]} label={t.counts[k](counts[k])} />
            ))
        ) : (
          <span>{t.loading}</span>
        )}
      </div>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder={t.searchPlaceholder}
        searchLabel={t.search}
        filter={filter}
        onFilter={setFilter}
        filterLabel={t.filterBy}
        options={(["all", "selected", ...TYPES] as const)
          .filter(
            (f) => f === "all" || f === "selected" || !counts || counts[f],
          )
          .map((f) => ({
            value: f,
            label: t.filters[f],
            ...(f !== "all" && counts && { count: counts[f] }),
          }))}
      />
      <ScrollList
        query={query}
        noMatch={t.noMatch}
        rows={
          shown?.map((c) => (
            <ConversationItem
              key={c.id}
              conv={c}
              checked={slackChannels.includes(c.id)}
              onChange={(on) => set(withShown(slackChannels, [c], on))}
            />
          )) ?? null
        }
        skeleton={
          <>
            <span className={cn("size-4 shrink-0 rounded-sm", pulse)} />
            <span className={cn("size-6 shrink-0 rounded-full", pulse)} />
            <span className={cn("h-3 w-40 rounded-sm", pulse)} />
          </>
        }
      />
      <ListFooter shown={shown?.length} total={convs?.length ?? 0}>
        {shown && shown.length > 0 && (
          <span className="flex gap-1">
            <Button
              variant="ghost"
              size="xs"
              disabled={all!.length === slackChannels.length}
              onClick={() => set(all!)}
            >
              {t.selectShown}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={none!.length === slackChannels.length}
              onClick={() => set(none!)}
            >
              {t.clearShown}
            </Button>
          </span>
        )}
      </ListFooter>
    </div>
  )
}

/** Ligne cochable : case, avatar du contact (DM 1:1) ou icône du type, nom, type. */
function ConversationItem({
  conv: c,
  checked,
  onChange,
}: {
  conv: SlackConversation
  checked: boolean
  onChange: (on: boolean) => void
}) {
  const t = useStrings(S)
  const Icon = c.kind === "im" ? null : ICON[c.kind]
  return (
    <li className={cn(LIST_ROW, "p-0")}>
      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-1 transition-colors duration-150 ease-out hover:bg-muted/50">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 shrink-0 accent-primary"
        />
        {Icon ? (
          <span
            aria-hidden
            className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
          >
            <Icon className="size-3.5" />
          </span>
        ) : (
          <SlackAvatar contact={{ name: c.name, image: c.contact?.image }} />
        )}
        <span className="min-w-0 truncate text-sm">{c.name}</span>
        {c.contact?.handle && (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            @{c.contact.handle}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {t.kinds[c.kind]}
        </span>
      </label>
    </li>
  )
}
