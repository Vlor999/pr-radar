import { RotateCcw } from "lucide-react"
import { cn } from "cn"

import { Avatar } from "@/components/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { locale, strings, useStrings } from "@/lib/i18n"
import { HOUR_MS } from "@/lib/quiet"
import { filterReviews, groupByRepo, reviewKey, type Who } from "@/lib/review"
import { updateSettings, useSettings } from "@/lib/settings"
import type { ReviewPr } from "@/lib/types"

const S = strings(
  {
    who: { all: "Tout", me: "Moi", team: "Équipe" },
    filter: "Filtrer les demandes",
    hideApproved: "Masquer déjà approuvées",
    hideApprovedTitle: "Cache les PR demandées à une équipe et déjà approuvées",
    none: "Aucune PR n'attend ta review.",
    noMatch: "Aucune PR ne correspond aux filtres.",
    me: "moi",
    team: "équipe",
    rerequest: "re-request",
    rerequestTitle: "Tu as déjà reviewé cette PR : nouvelle demande",
    agoNow: "à l'instant",
    agoH: (h: number) => `il y a ${h} h`,
    agoD: (d: number) => `il y a ${d} j`,
  },
  {
    who: { all: "All", me: "Me", team: "Team" },
    filter: "Filter requests",
    hideApproved: "Hide already approved",
    hideApprovedTitle: "Hides PRs requested from a team and already approved",
    none: "No PR is waiting for your review.",
    noMatch: "No PR matches the filters.",
    me: "me",
    team: "team",
    rerequest: "re-request",
    rerequestTitle: "You already reviewed this PR: new request",
    agoNow: "just now",
    agoH: (h: number) => `${h}h ago`,
    agoD: (d: number) => `${d}d ago`,
  },
)

const WHO: Who[] = ["all", "me", "team"]

function ago(iso: string, t: typeof S.fr) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / HOUR_MS)
  return h >= 48 ? t.agoD(Math.floor(h / 24)) : h ? t.agoH(h) : t.agoNow
}

export function ReviewList({ reviews }: { reviews: ReviewPr[] }) {
  const t = useStrings(S)
  const { reviewWho: who, reviewHideApproved: hideApproved } = useSettings()
  const groups = groupByRepo(filterReviews(reviews, who, hideApproved))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1" role="group" aria-label={t.filter}>
        {WHO.map((w) => (
          <Button
            key={w}
            size="xs"
            variant={who === w ? "default" : "outline"}
            aria-pressed={who === w}
            onClick={() => updateSettings({ reviewWho: w })}
          >
            {t.who[w]}
            <Badge variant={who === w ? "secondary" : "outline"}>
              {filterReviews(reviews, w, hideApproved).length}
            </Badge>
          </Button>
        ))}
        <Button
          size="xs"
          variant={hideApproved ? "default" : "outline"}
          aria-pressed={hideApproved}
          title={t.hideApprovedTitle}
          onClick={() => updateSettings({ reviewHideApproved: !hideApproved })}
          className="ml-2"
        >
          {t.hideApproved}
        </Button>
      </div>

      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {reviews.length ? t.noMatch : t.none}
        </p>
      )}
      {groups.map(([repo, prs]) => (
        <div key={repo} className="flex flex-col gap-2">
          <h2 className="font-mono text-sm font-medium">{repo}</h2>
          <ul className="flex flex-col gap-2">
            {prs.map((p) => (
              <li key={reviewKey(p)}>
                <ReviewRow pr={p} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** ● moi / ◌ équipe(s) */
function WhoBadge({ pr }: { pr: ReviewPr }) {
  const t = useStrings(S)
  return (
    <Badge
      variant={pr.direct ? "default" : "outline"}
      className="shrink-0 self-center"
    >
      {pr.direct ? `● ${t.me}` : `◌ ${pr.teams.join(", ") || t.team}`}
    </Badge>
  )
}

function Flags({ pr }: { pr: ReviewPr }) {
  const t = useStrings(S)
  return (
    <>
      {pr.draft && (
        <Badge variant="secondary" className="shrink-0 self-center">
          Draft
        </Badge>
      )}
      {pr.rerequest && (
        <Badge
          variant="outline"
          title={t.rerequestTitle}
          className="shrink-0 self-center text-amber-700 dark:text-amber-400"
        >
          <RotateCcw />
          {t.rerequest}
        </Badge>
      )}
    </>
  )
}

function ReviewRow({ pr }: { pr: ReviewPr }) {
  const t = useStrings(S)
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener"
      data-pr-card=""
      data-url={pr.url}
      className={cn(
        "flex max-w-xl items-baseline gap-2 rounded-2xl border bg-card px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary",
        pr.draft && "opacity-70",
      )}
    >
      <WhoBadge pr={pr} />
      <span className="shrink-0 text-muted-foreground tabular-nums">
        #{pr.number}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{pr.title}</span>
      <Flags pr={pr} />
      <Avatar login={pr.author} url={pr.url} className="self-center" />
      <span
        className="shrink-0 text-xs text-muted-foreground"
        title={new Date(pr.since).toLocaleString(locale())}
      >
        {ago(pr.since, t)}
      </span>
    </a>
  )
}
