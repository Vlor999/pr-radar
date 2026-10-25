import { memo, useTransition } from "react"
import { ChevronRight, GitBranch, GitMerge, Trash2 } from "lucide-react"
import { cn } from "cn"

import { removeRepo } from "@/lib/actions"
import { PrCard, SlackColumn } from "@/components/pr-card"
import { ThreadColumn } from "@/components/thread-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { strings, useStrings } from "@/lib/i18n"
import { useSettings } from "@/lib/settings"
import { descendants, needsAttention } from "@/lib/tree"
import type { MergedPr, PrNode, RepoTree } from "@/lib/types"

const S = strings(
  {
    attn: (n: number) => `${n} à traiter`,
    remove: (repo: string) => `Retirer ${repo}`,
    noMatch: "Aucune PR ne correspond",
    noOpen: "Aucune PR ouverte",
    noOwnPr: "(branche sans PR à moi)",
    agoNow: "à l'instant",
    agoH: (h: number) => `il y a ${h} h`,
    agoD: (d: number) => `il y a ${d} j`,
    merged: (days: number) => `Mergées ces ${days} derniers jours`,
  },
  {
    attn: (n: number) => `${n} need${n > 1 ? "" : "s"} action`,
    remove: (repo: string) => `Remove ${repo}`,
    noMatch: "No matching PRs",
    noOpen: "No open PRs",
    noOwnPr: "(none of my PRs on this branch)",
    agoNow: "just now",
    agoH: (h: number) => `${h}h ago`,
    agoD: (d: number) => `${d}d ago`,
    merged: (days: number) => `Merged in the last ${days} days`,
  },
)

export type OpenState = {
  isOpen: (key: string, fallback: boolean) => boolean
  toggle: (key: string, v: boolean) => void
  isNew: (p: PrNode) => boolean
  markSeen: (ps: PrNode[]) => void
}

// memo : un repo dont l'arbre et l'état n'ont pas changé saute le rendu (frappe, stores réglages/Slack)
export const RepoSection = memo(function RepoSection({
  tree,
  total,
  state,
}: {
  tree: RepoTree
  total: number
  state: OpenState
}) {
  const shown = tree.roots.flatMap(descendants)
  const attn = shown.filter(needsAttention).length
  const [removing, start] = useTransition()
  const t = useStrings(S)

  return (
    <Collapsible
      open={state.isOpen(tree.repo, true)}
      onOpenChange={(v) => state.toggle(tree.repo, v)}
    >
      {/* collé en haut tant qu'on défile dans ce repo, poussé par l'en-tête du repo suivant (comme les fichiers d'une PR GitHub) */}
      <div className="group/repo sticky top-0 z-20 -mx-2 flex items-center gap-2 border-b bg-background/90 px-2 py-1 backdrop-blur">
        <CollapsibleTrigger className="group flex min-w-0 items-center gap-2 rounded-md py-1 text-base font-semibold">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
          <span className="truncate">{tree.repo}</span>
          <Badge variant="secondary">
            {shown.length === total ? total : `${shown.length} / ${total}`}
          </Badge>
          {attn > 0 && <Badge variant="destructive">{t.attn(attn)}</Badge>}
        </CollapsibleTrigger>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t.remove(tree.repo)}
          title={t.remove(tree.repo)}
          disabled={removing}
          className="opacity-0 group-hover/repo:opacity-100 focus-visible:opacity-100"
          onClick={() => start(() => removeRepo(tree.repo))}
        >
          <Trash2 />
        </Button>
      </div>
      <CollapsibleContent>
        {tree.roots.length === 0 ? (
          <p className="py-2 pl-6 text-sm text-muted-foreground">
            {total ? t.noMatch : t.noOpen}
          </p>
        ) : (
          <ul className="flex flex-col gap-2 pt-2 pb-4 pl-1">
            {tree.roots.map((root) => (
              <li key={root.branch}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 font-mono text-xs font-semibold",
                    !root.trunk && "border-dashed",
                  )}
                >
                  <GitBranch className="size-3.5" />
                  {root.branch}
                  {!root.trunk && (
                    <span className="font-sans font-normal text-muted-foreground">
                      {t.noOwnPr}
                    </span>
                  )}
                </span>
                <Branches nodes={root.children} state={state} />
              </li>
            ))}
          </ul>
        )}
        {tree.merged.length > 0 && (
          <MergedList prs={tree.merged} state={state} repo={tree.repo} />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
})

function mergedAgo(iso: string, t: typeof S.fr) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000)
  return h >= 24 ? t.agoD(Math.floor(h / 24)) : h ? t.agoH(h) : t.agoNow
}

/** PR mergées ces derniers jours : une ligne chacune, sous l'arbre des PR ouvertes. */
function MergedList({
  prs,
  repo,
  state,
}: {
  prs: MergedPr[]
  repo: string
  state: OpenState
}) {
  const { mergedDays } = useSettings()
  const t = useStrings(S)
  const key = `${repo}:merged`
  return (
    <Collapsible
      open={state.isOpen(key, true)}
      onOpenChange={(v) => state.toggle(key, v)}
      className="pb-4 pl-1"
    >
      <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md py-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
        <GitMerge className="size-3.5 text-violet-600 dark:text-violet-400" />
        {t.merged(mergedDays)}
        <Badge variant="outline">{prs.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex max-w-xl flex-col pt-1 pl-5">
          {prs.map((p) => (
            <li key={p.number}>
              <a
                href={p.url}
                target="_blank"
                rel="noopener"
                className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted"
              >
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  #{p.number}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {mergedAgo(p.mergedAt, t)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Un niveau de l'arbre, relié au parent par des coudes. */
function Branches({ nodes, state }: { nodes: PrNode[]; state: OpenState }) {
  return (
    <ul className="flex flex-col pl-7">
      {nodes.map((n) => {
        const key = `${n.repo}#${n.number}`
        const open = state.isOpen(key, false)
        const slackOpen = state.isOpen(`${key}:slack`, false)
        const threadsOpen = open && n.threads.length > 0
        return (
          <li
            key={n.number}
            className={cn(
              "relative pt-2",
              "before:absolute before:top-0 before:-left-4.5 before:h-9 before:w-4 before:rounded-bl-lg before:border-b-2 before:border-l-2 before:border-border",
              "not-last:after:absolute not-last:after:top-0 not-last:after:bottom-0 not-last:after:-left-4.5 not-last:after:border-l-2 not-last:after:border-border",
            )}
          >
            {/*
              carte dépliée : ses discussions ouvertes s'affichent dessous, même largeur que la carte.
              Le rail vers les PR stackées traverse tout ce bloc (messages Slack et discussions compris) ;
              la carte, positionnée après lui, le recouvre. Valeurs liées : left-2.5 = pl-7 - 4.5 (coudes
              -left-4.5 de Branches) ; top-6 : sous l'arrondi de la carte.
            */}
            <div
              className={cn(
                "@container relative flex flex-col gap-3",
                n.children.length > 0 &&
                  "before:absolute before:top-6 before:bottom-0 before:left-2.5 before:border-l-2 before:border-border",
              )}
            >
              {/*
                Grille : à gauche la carte puis ses discussions, à droite les messages Slack (alignés en haut
                sur la carte, sur la hauteur carte + discussions) quand le conteneur fait au moins 44rem
                (carte 26 au minimum + écart 0,75 + colonne 16,25 + 1 de marge). Plus étroit : une seule
                colonne, carte, Slack puis discussions, en retrait. Marge droite pr-4 : le panneau du repo est
                en overflow-hidden (animation de hauteur) et couperait l'ombre d'une colonne collée à son bord.
                Ligne 2 en 1fr : la hauteur de la colonne Slack va à cette ligne, pas entre carte et discussions.
              */}
              <div
                className={cn(
                  // --slack-w : 16,25rem, jusqu'à 22,5rem une fois la carte à sa largeur max (36rem).
                  // Ouverture / fermeture : la colonne Slack passe de 0 à --slack-w, la carte se resserre en douceur.
                  "grid gap-3 [--slack-w:clamp(16.25rem,calc(100cqw-37.75rem),22.5rem)] @[44rem]:grid-rows-[auto_1fr] @[44rem]:pr-4 @[44rem]:transition-[grid-template-columns] @[44rem]:duration-200 @[44rem]:ease-out motion-reduce:transition-none",
                  slackOpen
                    ? "@[44rem]:grid-cols-[minmax(0,36rem)_var(--slack-w)]"
                    : "@[44rem]:grid-cols-[minmax(0,36rem)_0px]",
                )}
              >
                <div className="relative w-full max-w-xl min-w-0 @[44rem]:col-start-1">
                  <PrCard
                    pr={n}
                    open={open}
                    isNew={state.isNew(n)}
                    onOpenChange={(v) => {
                      state.toggle(key, v)
                      if (v) state.markSeen([n]) // déplier une carte = l'avoir vue
                    }}
                    slackOpen={slackOpen}
                    onSlackToggle={() =>
                      state.toggle(`${key}:slack`, !slackOpen)
                    }
                  />
                </div>
                <SlackColumn
                  url={n.url}
                  open={slackOpen}
                  bridge={threadsOpen}
                />
                {threadsOpen && (
                  <div className="w-full max-w-xl min-w-0 @[44rem]:col-start-1">
                    <ThreadColumn threads={n.threads} repo={n.repo} />
                  </div>
                )}
              </div>
            </div>
            {n.children.length > 0 && (
              <Branches nodes={n.children} state={state} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
