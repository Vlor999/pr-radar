import {
  ChevronRight,
  Clock,
  ExternalLink,
  GitMerge,
  GitPullRequestArrow,
  MessageSquare,
} from "lucide-react"
import { cn } from "cn"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { currentLang, locale, strings, useStrings } from "@/lib/i18n"
import { useSettings } from "@/lib/settings"
import { useMentions } from "@/lib/slack"
import { slackParts } from "@/lib/slack-text"
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
    slackTitle: "Lien posté sur Slack",
    slackMentions: "Mentions Slack",
    openInSlack: "Ouvrir dans Slack",
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
    slackTitle: "Link posted on Slack",
    slackMentions: "Slack mentions",
    openInSlack: "Open in Slack",
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

/** Logo Slack officiel (4 couleurs), en ligne : pas de dépendance. */
const SlackLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 122.8 122.8" aria-hidden className={className}>
    <path
      fill="#e01e5a"
      d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
    />
    <path
      fill="#36c5f0"
      d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
    />
    <path
      fill="#2eb67d"
      d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
    />
    <path
      fill="#ecb22e"
      d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
    />
  </svg>
)

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
  slackOpen,
  onSlackToggle,
}: {
  pr: PrNode
  open: boolean
  isNew: boolean
  onOpenChange: (v: boolean) => void
  /** colonne des messages Slack affichée à droite de la carte */
  slackOpen: boolean
  onSlackToggle: () => void
}) {
  const t = useStrings(S)
  const decision = pr.decision && pr.decision in STATUS ? pr.decision : "NONE"
  const ci = pr.ci ? CI[pr.ci] : undefined
  const merge = mergeState(pr)
  const { staleDays } = useSettings()
  const mentions = useMentions(pr.url)

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
            {mentions.length > 0 && (
              <Badge
                variant="outline"
                title={t.slackTitle}
                role="button"
                tabIndex={0}
                aria-pressed={slackOpen}
                // pastille dans le déclencheur de la carte : ouvre la colonne Slack, pas la carte
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onSlackToggle()
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return
                  e.stopPropagation()
                  e.preventDefault()
                  onSlackToggle()
                }}
                className={cn(
                  "cursor-pointer bg-background pl-1.5 hover:bg-muted dark:bg-muted",
                  slackOpen && "ring-2 ring-ring/40",
                )}
              >
                <SlackLogo />
                {mentions.length}
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

/** Messages Slack qui citent la PR : une carte par message, en colonne à droite de la carte. */
/** durée des animations d'ouverture / fermeture de la colonne (comme les panneaux repliables) */
const SLACK_ANIM_MS = 200

export function SlackColumn({
  url,
  open,
  bridge,
}: {
  url: string
  open: boolean
  /** discussions affichées dessous (colonne unique) : le trait de leur coude traverse la colonne Slack */
  bridge: boolean
}) {
  const t = useStrings(S)
  const mentions = useMentions(url)
  // fermeture : la colonne reste le temps de son animation de sortie
  const [shown, setShown] = useState(open)
  useEffect(() => {
    if (open) return setShown(true)
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    const id = setTimeout(
      () => setShown(false),
      reduced.matches ? 0 : SLACK_ANIM_MS,
    )
    return () => clearTimeout(id)
  }, [open])
  if (!mentions.length || !(open || shown)) return null
  return (
    <ul
      aria-label={t.slackMentions}
      // à droite (grille de repo-section, largeur --slack-w) : sur deux lignes, entre par la droite ; dessous :
      // largeur de carte, entre par le haut comme les discussions. Trait du pont : left-9.5 = pl-14 - 4.5,
      // comme les coudes des discussions (thread-panel) ; -top-3 / -bottom-3 = gap-3 autour de la colonne.
      className={cn(
        "flex w-full max-w-xl min-w-0 flex-col gap-3 pl-14 duration-200 ease-out motion-reduce:animate-none @[44rem]:col-start-2 @[44rem]:row-span-2 @[44rem]:row-start-1 @[44rem]:w-(--slack-w) @[44rem]:pl-0",
        open
          ? "animate-in fade-in slide-in-from-top-2 @[44rem]:slide-in-from-top-0 @[44rem]:slide-in-from-right-8"
          : "animate-out fill-mode-forwards fade-out slide-out-to-top-2 @[44rem]:slide-out-to-top-0 @[44rem]:slide-out-to-right-8",
        bridge &&
          "relative before:absolute before:-top-3 before:-bottom-3 before:left-9.5 before:border-l-2 before:border-border @[44rem]:before:hidden",
      )}
    >
      {mentions.map((m) => (
        <li key={m.permalink}>
          <Card
            size="sm"
            className="gap-1 rounded-2xl rounded-tl-md px-4 py-3 text-sm shadow-sm ring-foreground/10"
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SlackLogo className="size-3.5 shrink-0" />
              <span className="font-medium text-foreground">{m.author}</span>
              <span className="truncate" title={m.where}>
                · {m.where}
              </span>
              <span className="ml-auto shrink-0">
                {new Date(m.at).toLocaleDateString(locale())}
              </span>
            </div>
            <p className="break-words whitespace-pre-wrap">
              {slackParts(m.text).map((p, i) =>
                p.href ? (
                  <a
                    key={i}
                    href={p.href}
                    target="_blank"
                    rel="noopener"
                    className="text-primary hover:underline"
                  >
                    {p.text}
                  </a>
                ) : (
                  p.text
                ),
              )}
            </p>
            <a
              href={m.permalink}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t.openInSlack} <ExternalLink className="size-3" />
            </a>
          </Card>
        </li>
      ))}
    </ul>
  )
}
