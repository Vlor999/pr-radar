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
import { currentLang, strings, useStrings } from "@/lib/i18n"
import { useSettings } from "@/lib/settings"
import { idleDays, isStale, mergeState, needsAttention } from "@/lib/tree"
import type { PrNode } from "@/lib/types"

const S = strings(
  {
    status: {
      APPROVED: "Approuvée",
      CHANGES_REQUESTED: "Changements demandés",
      REVIEW_REQUIRED: "Review en attente",
      NONE: "Pas de review",
    } as Record<string, string>,
    review: {
      APPROVED: "approuvée",
      CHANGES_REQUESTED: "changements demandés",
      COMMENTED: "commentée",
      DISMISSED: "rejetée",
    } as Record<string, string>,
    agoNow: "à l'instant",
    agoH: (h: number) => `il y a ${h} h`,
    agoD: (d: number) => `il y a ${d} j`,
    fresh: "Nouveau",
    freshTitle: "A bougé depuis ta dernière visite",
    filesChanged: (n: number) =>
      `${plural(n, "fichier")} modifié${n > 1 ? "s" : ""}`,
    files: (n: number) => plural(n, "fichier"),
    readyToMerge: "Prête à merger",
    conflict: "Conflit",
    unresolved: (n: number) => plural(n, "non résolu"),
    blockedBy: (n: number) => `bloquée par #${n}`,
    blocks: (n: number) => `bloque ${plural(n, "PR")}`,
    inactive: (d: number) => `inactive depuis ${d} j`,
    reviewOf: "Review",
    sep: " : ",
    requested: "Review attendue :",
    noReviewer: "Aucun reviewer",
    othersComments: (n: number) => `${plural(n, "commentaire")} des autres`,
    lastActivity: (ago: string) => `Dernière activité ${ago}`,
    openOnGithub: "Ouvrir sur GitHub",
  },
  {
    status: {
      APPROVED: "Approved",
      CHANGES_REQUESTED: "Changes requested",
      REVIEW_REQUIRED: "Review pending",
      NONE: "No review",
    },
    review: {
      APPROVED: "approved",
      CHANGES_REQUESTED: "changes requested",
      COMMENTED: "commented",
      DISMISSED: "dismissed",
    },
    agoNow: "just now",
    agoH: (h: number) => `${h}h ago`,
    agoD: (d: number) => `${d}d ago`,
    fresh: "New",
    freshTitle: "Changed since your last visit",
    filesChanged: (n: number) => `${plural(n, "file")} changed`,
    files: (n: number) => plural(n, "file"),
    readyToMerge: "Ready to merge",
    conflict: "Conflict",
    unresolved: (n: number) => `${n} unresolved`,
    blockedBy: (n: number) => `blocked by #${n}`,
    blocks: (n: number) => `blocks ${plural(n, "PR")}`,
    inactive: (d: number) => `stale for ${d}d`,
    reviewOf: "Review by",
    sep: ": ",
    requested: "Review requested:",
    noReviewer: "No reviewer",
    othersComments: (n: number) => `${plural(n, "comment")} from others`,
    lastActivity: (ago: string) => `Last activity ${ago}`,
    openOnGithub: "Open on GitHub",
  },
)

const STATUS: Record<string, "default" | "destructive" | "outline"> = {
  APPROVED: "default",
  CHANGES_REQUESTED: "destructive",
  REVIEW_REQUIRED: "outline",
  NONE: "outline",
}
const CI: Record<string, { label: string; bad?: boolean }> = {
  SUCCESS: { label: "CI ✓" },
  FAILURE: { label: "CI ✗", bad: true },
  ERROR: { label: "CI ✗", bad: true },
  PENDING: { label: "CI …" },
  EXPECTED: { label: "CI …" },
}

/** « 0 PR » en français, « 0 PRs » en anglais. */
export const plural = (n: number, word: string) =>
  `${n} ${word}${n > 1 || (n === 0 && currentLang() === "en") ? "s" : ""}`

function ago(iso: string, t: typeof S.fr) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000)
  return h >= 48 ? t.agoD(Math.floor(h / 24)) : h ? t.agoH(h) : t.agoNow
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
  const t = useStrings(S)
  const decision = pr.decision && pr.decision in STATUS ? pr.decision : "NONE"
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
              <Badge className="shrink-0 self-center" title={t.freshTitle}>
                {t.fresh}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 pl-5.5 font-mono text-xs text-muted-foreground">
            <span className="break-all">
              {pr.head} → {pr.base}
            </span>
            <span className="tabular-nums" title={t.filesChanged(pr.files)}>
              <span className="text-green-600 dark:text-green-400">
                +{pr.additions}
              </span>{" "}
              <span className="text-destructive">−{pr.deletions}</span> ·{" "}
              {t.files(pr.files)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 pl-5.5">
            {merge?.kind === "ready" && (
              <Badge>
                <GitMerge />
                {t.readyToMerge}
              </Badge>
            )}
            <Badge variant={STATUS[decision]}>{t.status[decision]}</Badge>
            {pr.draft && <Badge variant="secondary">Draft</Badge>}
            {ci && (
              <Badge variant={ci.bad ? "destructive" : "outline"}>
                {ci.label}
              </Badge>
            )}
            {pr.conflicting && (
              <Badge variant="destructive">{t.conflict}</Badge>
            )}
            {pr.comments > 0 && (
              <Badge variant="outline">
                <MessageSquare />
                {pr.comments}
              </Badge>
            )}
            {pr.unresolved > 0 && (
              <Badge variant="destructive">{t.unresolved(pr.unresolved)}</Badge>
            )}
            {merge?.kind === "blocked" && (
              <Badge variant="secondary">
                <GitPullRequestArrow />
                {t.blockedBy(merge.by)}
              </Badge>
            )}
            {pr.children.length > 0 && (
              <Badge variant="secondary">
                <GitPullRequestArrow />
                {t.blocks(pr.children.length)}
              </Badge>
            )}
            {isStale(pr, Date.now(), staleDays) && (
              <Badge
                variant="outline"
                className="text-amber-700 dark:text-amber-400"
              >
                <Clock />
                {t.inactive(idleDays(pr))}
              </Badge>
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t px-4 py-3 pl-10 text-sm">
            <ul className="flex flex-col gap-1">
              {pr.reviews.map((r) => (
                <li key={r.who}>
                  {t.reviewOf}{" "}
                  <span
                    className={cn(
                      "font-medium",
                      r.state === "APPROVED" && "text-primary",
                      r.state === "CHANGES_REQUESTED" && "text-destructive",
                    )}
                  >
                    {r.who}
                  </span>
                  {t.sep}
                  {t.review[r.state] ?? r.state.toLowerCase()}
                </li>
              ))}
              {pr.requested.map((who) => (
                <li key={who}>
                  <span className="text-muted-foreground">{t.requested}</span>{" "}
                  {who}
                </li>
              ))}
              {pr.reviews.length + pr.requested.length === 0 && (
                <li className="text-muted-foreground">{t.noReviewer}</li>
              )}
              <li>{t.othersComments(pr.comments)}</li>
              <li className="text-muted-foreground">
                {t.lastActivity(ago(pr.updated, t))}
              </li>
              <li>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {t.openOnGithub} <ExternalLink className="size-3.5" />
                </a>
              </li>
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
