
import { useTransition } from "react"
import { ChevronRight, GitBranch, GitMerge, Trash2 } from "lucide-react"
import { cn } from "cn"

import { removeRepo } from "@/lib/actions"
import { PrCard } from "@/components/pr-card"
import { ThreadColumn } from "@/components/thread-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { descendants, needsAttention } from "@/lib/tree"
import type { MergedPr, PrNode, RepoTree } from "@/lib/types"

export type OpenState = {
  isOpen: (key: string, fallback: boolean) => boolean
  toggle: (key: string, v: boolean) => void
  isNew: (p: PrNode) => boolean
  markSeen: (ps: PrNode[]) => void
}

export function RepoSection({
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
          {attn > 0 && <Badge variant="destructive">{attn} à traiter</Badge>}
        </CollapsibleTrigger>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Retirer ${tree.repo}`}
          title={`Retirer ${tree.repo}`}
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
            {total ? "Aucune PR ne correspond" : "Aucune PR ouverte"}
          </p>
        ) : (
          <ul className="flex flex-col gap-2 pt-2 pb-4 pl-1">
            {tree.roots.map((root) => (
              <li key={root.branch}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 font-mono text-xs font-semibold",
                    !root.trunk && "border-dashed"
                  )}
                >
                  <GitBranch className="size-3.5" />
                  {root.branch}
                  {!root.trunk && (
                    <span className="font-sans font-normal text-muted-foreground">
                      (branche sans PR à moi)
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
}

function mergedAgo(iso: string) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000)
  return h >= 24
    ? `il y a ${Math.floor(h / 24)} j`
    : h
      ? `il y a ${h} h`
      : "à l'instant"
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
        Mergées ces 7 derniers jours
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
                  {mergedAgo(p.mergedAt)}
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
        return (
          <li
            key={n.number}
            className={cn(
              "relative pt-2",
              "before:absolute before:top-0 before:-left-4.5 before:h-9 before:w-4 before:rounded-bl-lg before:border-b-2 before:border-l-2 before:border-border",
              "not-last:after:absolute not-last:after:top-0 not-last:after:bottom-0 not-last:after:-left-4.5 not-last:after:border-l-2 not-last:after:border-border"
            )}
          >
            {/* carte dépliée : ses discussions ouvertes s'affichent dessous, même largeur que la carte */}
            <div className="flex flex-col gap-3">
              <div className="w-full max-w-xl">
                <PrCard
                  pr={n}
                  open={open}
                  isNew={state.isNew(n)}
                  onOpenChange={(v) => {
                    state.toggle(key, v)
                    if (v) state.markSeen([n]) // déplier une carte = l'avoir vue
                  }}
                />
              </div>
              {open && n.threads.length > 0 && (
                <div className="w-full max-w-xl min-w-0">
                  <ThreadColumn threads={n.threads} />
                </div>
              )}
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
