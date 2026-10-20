import {
  ChevronRight,
  Clock,
  ExternalLink,
  GitMerge,
  GitPullRequestArrow,
  MessageSquare,
} from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useSettings } from "@/lib/settings"
import { idleDays, isStale, mergeState, needsAttention } from "@/lib/tree"
import type { PrNode } from "@/lib/types"

const STATUS: Record<
  string,
  { label: string; variant: "default" | "destructive" | "outline" }
> = {
  APPROVED: { label: "Approuvée", variant: "default" },
  CHANGES_REQUESTED: { label: "Changements demandés", variant: "destructive" },
  REVIEW_REQUIRED: { label: "Review en attente", variant: "outline" },
  NONE: { label: "Pas de review", variant: "outline" },
}
const CI: Record<string, { label: string; bad?: boolean }> = {
  SUCCESS: { label: "CI ✓" },
  FAILURE: { label: "CI ✗", bad: true },
  ERROR: { label: "CI ✗", bad: true },
  PENDING: { label: "CI …" },
  EXPECTED: { label: "CI …" },
}
const REVIEW: Record<string, string> = {
  APPROVED: "approuvée",
  CHANGES_REQUESTED: "changements demandés",
  COMMENTED: "commentée",
  DISMISSED: "rejetée",
}

export const plural = (n: number, word: string) =>
  `${n} ${word}${n > 1 ? "s" : ""}`

function ago(iso: string) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000)
  return h >= 48
    ? `il y a ${Math.floor(h / 24)} j`
    : h
      ? `il y a ${h} h`
      : "à l'instant"
}

export function PrCard({
  pr,
  open,
  isNew,
  onOpenChange,
}: {
  pr: PrNode
  open: boolean
  isNew: boolean
  onOpenChange: (v: boolean) => void
}) {
  const status = STATUS[pr.decision ?? "NONE"] ?? STATUS.NONE
  const ci = pr.ci ? CI[pr.ci] : undefined
  const merge = mergeState(pr)
  const { staleDays } = useSettings()

  return (
    <Card
      size="sm"
      className={cn(
        "w-full max-w-xl gap-0 rounded-2xl py-0 transition-[box-shadow,background-color] duration-150",
        // carte sélectionnée au clavier (j/k) : contour épais + fond teinté, bien visible
        "has-[[data-pr-card]:focus-visible]:bg-primary/5 has-[[data-pr-card]:focus-visible]:shadow-lg has-[[data-pr-card]:focus-visible]:ring-2 has-[[data-pr-card]:focus-visible]:ring-primary",
        needsAttention(pr) && "border-l-4 border-l-destructive",
        merge?.kind === "ready" && "border-l-4 border-l-primary",
      )}
    >
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger
          data-pr-card=""
          data-url={pr.url}
          className="group flex w-full scroll-mt-16 flex-col gap-1.5 rounded-2xl px-4 py-3 text-left outline-none"
        >
          <div className="flex w-full items-baseline gap-2">
            <ChevronRight className="size-3.5 shrink-0 self-center text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
            <a
              href={pr.url}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-muted-foreground tabular-nums hover:underline"
            >
              #{pr.number}
            </a>
            <span className="min-w-0 flex-1 font-medium">{pr.title}</span>
            {isNew && (
              <Badge
                className="shrink-0 self-center"
                title="A bougé depuis ta dernière visite"
              >
                Nouveau
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 pl-5.5 font-mono text-xs text-muted-foreground">
            <span className="break-all">
              {pr.head} → {pr.base}
            </span>
            <span
              className="tabular-nums"
              title={`${plural(pr.files, "fichier")} modifié${pr.files > 1 ? "s" : ""}`}
            >
              <span className="text-green-600 dark:text-green-400">
                +{pr.additions}
              </span>{" "}
              <span className="text-destructive">−{pr.deletions}</span> ·{" "}
              {plural(pr.files, "fichier")}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 pl-5.5">
            {merge?.kind === "ready" && (
              <Badge>
                <GitMerge />
                Prête à merger
              </Badge>
            )}
            <Badge variant={status.variant}>{status.label}</Badge>
            {pr.draft && <Badge variant="secondary">Draft</Badge>}
            {ci && (
              <Badge variant={ci.bad ? "destructive" : "outline"}>
                {ci.label}
              </Badge>
            )}
            {pr.conflicting && <Badge variant="destructive">Conflit</Badge>}
            {pr.comments > 0 && (
              <Badge variant="outline">
                <MessageSquare />
                {pr.comments}
              </Badge>
            )}
            {pr.unresolved > 0 && (
              <Badge variant="destructive">
                {plural(pr.unresolved, "non résolu")}
              </Badge>
            )}
            {merge?.kind === "blocked" && (
              <Badge variant="secondary">
                <GitPullRequestArrow />
                bloquée par #{merge.by}
              </Badge>
            )}
            {pr.children.length > 0 && (
              <Badge variant="secondary">
                <GitPullRequestArrow />
                bloque {plural(pr.children.length, "PR")}
              </Badge>
            )}
            {isStale(pr, Date.now(), staleDays) && (
              <Badge
                variant="outline"
                className="text-amber-700 dark:text-amber-400"
              >
                <Clock />
                inactive depuis {idleDays(pr)} j
              </Badge>
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t px-4 py-3 pl-10 text-sm">
            <ul className="flex flex-col gap-1">
              {pr.reviews.map((r) => (
                <li key={r.who}>
                  Review{" "}
                  <span
                    className={cn(
                      "font-medium",
                      r.state === "APPROVED" && "text-primary",
                      r.state === "CHANGES_REQUESTED" && "text-destructive",
                    )}
                  >
                    {r.who}
                  </span>{" "}
                  : {REVIEW[r.state] ?? r.state.toLowerCase()}
                </li>
              ))}
              {pr.requested.map((who) => (
                <li key={who}>
                  <span className="text-muted-foreground">
                    Review attendue :
                  </span>{" "}
                  {who}
                </li>
              ))}
              {pr.reviews.length + pr.requested.length === 0 && (
                <li className="text-muted-foreground">Aucun reviewer</li>
              )}
              <li>{plural(pr.comments, "commentaire")} des autres</li>
              <li className="text-muted-foreground">
                Dernière activité {ago(pr.updated)}
              </li>
              <li>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Ouvrir sur GitHub <ExternalLink className="size-3.5" />
                </a>
              </li>
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
