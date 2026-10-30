import {
  ChevronRight,
  CircleCheck,
  Clock,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestArrow,
  Layers,
  Loader2,
  MessageSquare,
  RefreshCw,
} from "lucide-react"
import { cn } from "cn"
import { useEffect, useState, useTransition } from "react"

import { AddReviewer } from "@/components/add-reviewer"
import { Avatar } from "@/components/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ready, syncBranch } from "@/lib/actions"
import { currentLang, locale, strings, useStrings } from "@/lib/i18n"
import { DONE_ICON, DONE_MS, pause, wait } from "@/lib/motion"
import { useSettings } from "@/lib/settings"
import { useMentions } from "@/lib/slack"
import { slackParts, spoofedHost } from "@/lib/slack-text"
import {
  idleDays,
  isStale,
  mergeState,
  nativeStack,
  needsAttention,
} from "@/lib/tree"
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
      APPROVED: "Approuvée",
      CHANGES_REQUESTED: "Changements demandés",
      COMMENTED: "Commentée",
      DISMISSED: "Rejetée",
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
    nativeStack: "Stack GitHub natif",
    blocks: (n: number) => `bloque ${plural(n, "PR")}`,
    inactive: (d: number) => `inactive depuis ${d} j`,
    requested: "En attente",
    noReviewer: "Aucun reviewer",
    othersComments: (n: number) => `${plural(n, "commentaire")} des autres`,
    lastActivity: (ago: string) => `Dernière activité ${ago}`,
    openOnGithub: "Ouvrir sur GitHub",
    slackTitle: "Lien posté sur Slack",
    slackMentions: "Mentions Slack",
    openInSlack: "Ouvrir dans Slack",
    markReady: "Prête pour review",
    markedReady: "Ouverte à la review",
    updateBranch: "Mettre à jour la branche",
    branchUpdated: "Branche à jour",
    updateBranchTitle: (base: string) => `Merge ${base} dans la branche`,
  },
  {
    status: {
      APPROVED: "Approved",
      CHANGES_REQUESTED: "Changes requested",
      REVIEW_REQUIRED: "Review pending",
      NONE: "No review",
    },
    review: {
      APPROVED: "Approved",
      CHANGES_REQUESTED: "Changes requested",
      COMMENTED: "Commented",
      DISMISSED: "Dismissed",
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
    nativeStack: "Native GitHub stack",
    blocks: (n: number) => `blocks ${plural(n, "PR")}`,
    inactive: (d: number) => `stale for ${d}d`,
    requested: "Pending",
    noReviewer: "No reviewer",
    othersComments: (n: number) => `${plural(n, "comment")} from others`,
    lastActivity: (ago: string) => `Last activity ${ago}`,
    openOnGithub: "Open on GitHub",
    slackTitle: "Link posted on Slack",
    slackMentions: "Slack mentions",
    openInSlack: "Open in Slack",
    markReady: "Ready for review",
    markedReady: "Open for review",
    updateBranch: "Update branch",
    branchUpdated: "Branch up to date",
    updateBranchTitle: (base: string) => `Merge ${base} into the branch`,
  },
)

/** rétractation du bouton, puis repli de la ligne (durée de CollapsibleContent, duration-200) */
const EXIT_MS = 200

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
  const stack = nativeStack(pr)
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
          className="group flex w-full scroll-mt-16 flex-col gap-1.5 rounded-2xl px-4 pt-3 pb-1.5 text-left outline-none"
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
        </CollapsibleTrigger>
        {/* pastilles hors du déclencheur : la pastille Slack est un vrai bouton, pas un interactif dans un
            bouton. Un clic ailleurs sur la ligne replie / déplie la carte, comme avant. */}
        <div
          className="flex flex-wrap gap-1 pr-4 pb-3 pl-9.5"
          onClick={(e) => {
            if (!(e.target as Element).closest("button")) onOpenChange(!open)
          }}
        >
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
          {pr.conflicting && <Badge variant="destructive">{t.conflict}</Badge>}
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
              aria-label={`${t.slackTitle} (${mentions.length})`}
              render={<button type="button" />}
              aria-pressed={slackOpen}
              onClick={onSlackToggle}
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
          {stack && (
            <Badge variant="secondary" title={t.nativeStack}>
              <Layers />
              {stack.position}/{stack.size}
            </Badge>
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
        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t px-4 py-3 pl-10 text-sm">
            <ul className="flex flex-col gap-2">
              {pr.reviews.map((r) => (
                <li key={r.who} className="flex items-center gap-2">
                  <Avatar login={r.who} url={pr.url} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {r.who}
                  </span>
                  <Badge variant={STATUS[r.state] ?? "outline"}>
                    {t.review[r.state] ?? r.state.toLowerCase()}
                  </Badge>
                </li>
              ))}
              {pr.requested.map(({ who, team }) => (
                <li key={who} className="flex items-center gap-2">
                  {/* équipe : pas d'avatar par login, l'initiale */}
                  <Avatar login={who} url={team ? undefined : pr.url} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {who}
                  </span>
                  <Badge variant="outline" className="text-muted-foreground">
                    <Clock />
                    {t.requested}
                  </Badge>
                </li>
              ))}
              <li className="flex items-center gap-2 text-muted-foreground">
                <AddReviewer pr={pr} />
                {pr.reviews.length + pr.requested.length === 0 && t.noReviewer}
              </li>
            </ul>
            {(pr.draft || pr.canUpdateBranch) && <PrActions pr={pr} />}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3.5" />
                {t.othersComments(pr.comments)}
              </span>
              <span
                className="inline-flex items-center gap-1"
                title={new Date(pr.updated).toLocaleString(locale())}
              >
                <Clock className="size-3.5" />
                {t.lastActivity(ago(pr.updated, t))}
              </span>
              <a
                href={pr.url}
                target="_blank"
                rel="noopener"
                className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
              >
                {t.openOnGithub} <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

type PrAction = "ready" | "update"

/** Actions d'écriture sur la PR : sortir du draft, mettre la branche à jour ; erreur de GitHub affichée dessous.
 * Succès : coche, puis le bouton se rétracte (la ligne se replie s'il était le dernier) avant la relecture. */
function PrActions({ pr }: { pr: PrNode }) {
  const t = useStrings(S)
  const [error, setError] = useState("")
  const [pending, start] = useTransition()
  const [running, setRunning] = useState<PrAction>()
  const [done, setDone] = useState<PrAction>()
  const [gone, setGone] = useState<PrAction[]>([])
  const shown = [
    pr.draft && ("ready" as const),
    pr.canUpdateBranch && ("update" as const),
  ].filter((a): a is PrAction => !!a)
  const open = shown.some((a) => !gone.includes(a))

  const run = (which: PrAction) =>
    start(async () => {
      setRunning(which)
      const res = await (which === "ready" ? ready : syncBranch)(
        pr.id,
        pr.repo,
        async () => {
          setDone(which)
          await wait(DONE_MS)
          setGone((g) => [...g, which])
          await pause(EXIT_MS)
        },
      )
      setError(res.error ?? "")
      // relecture faite : le bouton suit de nouveau les données (GitHub peut encore proposer l'action,
      // ou la reproposer à une actualisation suivante)
      setDone(undefined)
      setGone((g) => g.filter((a) => a !== which))
    })

  const button = (
    which: PrAction,
    Icon: typeof RefreshCw,
    label: string,
    doneLabel: string,
    title?: string,
  ) => (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      title={title}
      onClick={() => run(which)}
      className={cn(
        // largeur animée (transition-all du bouton) ; -mr-2 rattrape le gap-2 de la ligne
        "max-w-72 overflow-hidden motion-reduce:transition-none",
        done === which && "disabled:opacity-100",
        gone.includes(which) && "-mr-2 max-w-0 border-0 px-0 opacity-0",
      )}
    >
      {done === which ? (
        <CircleCheck className={DONE_ICON} />
      ) : pending && running === which ? (
        // mise à jour : l'icône de la branche tourne ; sinon le spinner des autres actions
        which === "update" ? (
          <RefreshCw className="animate-spin" />
        ) : (
          <Loader2 className="animate-spin" />
        )
      ) : (
        <Icon />
      )}
      {done === which ? doneLabel : label}
    </Button>
  )

  return (
    // repli de la ligne : -mt-3 rattrape le gap-3 du contenu de la carte
    <div
      className={cn(
        "transition-[margin] duration-200 motion-reduce:transition-none",
        !open && "-mt-3",
      )}
    >
      <Collapsible open={open}>
        <CollapsibleContent className="overflow-visible data-[ending-style]:overflow-hidden">
          <div className="flex flex-col gap-2 border-t pt-3">
            <div className="flex flex-wrap gap-2">
              {pr.draft &&
                button("ready", GitPullRequest, t.markReady, t.markedReady)}
              {pr.canUpdateBranch &&
                button(
                  "update",
                  RefreshCw,
                  t.updateBranch,
                  t.branchUpdated,
                  t.updateBranchTitle(pr.base),
                )}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
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
                    // le libellé peut mentir sur la cible : la vraie URL en infobulle, son hôte en clair si
                    // le libellé ressemble à l'URL d'un autre site
                    title={p.href}
                    className="text-primary hover:underline"
                  >
                    {p.text}
                    {spoofedHost(p) && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({spoofedHost(p)})
                      </span>
                    )}
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
