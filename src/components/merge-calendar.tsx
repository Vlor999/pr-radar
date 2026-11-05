import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { cn } from "cn"
import { mergedBetween } from "@/lib/actions"
import { locale, strings, useStrings } from "@/lib/i18n"
import type { MergedPr } from "@/lib/types"
import { TIMELINE_DEFAULT_DAYS, TIMELINE_WINDOWS } from "@/lib/constants"
import { PrTimeline, TimelineLegend } from "@/components/pr-timeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useThumb } from "@/hooks/use-thumb"

const PALETTE = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-cyan-500",
]
const MAX_VISIBLE = 3

const S = strings(
  {
    timeline: "Fil",
    month: "Mois",
    week: "Semaine",
    day: "Jour",
    emptyMonth: "Aucune PR mergée ce mois-ci",
    emptyWeek: "Aucune PR mergée cette semaine",
    emptyDay: "Aucune PR mergée ce jour-là",
    weekOf: (from: string, to: string) => `Semaine du ${from} au ${to}`,
    prev: (unit: string, week: boolean) =>
      `${unit} précédent${week ? "e" : ""}`,
    next: (unit: string, week: boolean) => `${unit} suivant${week ? "e" : ""}`,
    prevWindow: (n: number) => `${n} jours précédents`,
    nextWindow: (n: number) => `${n} jours suivants`,
    windowLabel: "Période",
    windowDays: (n: number) => `${n} j`,
    span: (from: string, to: string) => `Du ${from} au ${to}`,
    viewLabel: "Vue du calendrier",
    today: "Aujourd'hui",
    merged: (n: number) => `${n} PR mergée${n > 1 ? "s" : ""}`,
    viewDay: "Voir ce jour",
    collapse: "Réduire",
  },
  {
    timeline: "Timeline",
    month: "Month",
    week: "Week",
    day: "Day",
    emptyMonth: "No PRs merged this month",
    emptyWeek: "No PRs merged this week",
    emptyDay: "No PRs merged that day",
    weekOf: (from: string, to: string) => `Week of ${from} to ${to}`,
    prev: (unit: string) => `Previous ${unit.toLowerCase()}`,
    next: (unit: string) => `Next ${unit.toLowerCase()}`,
    prevWindow: (n: number) => `Previous ${n} days`,
    nextWindow: (n: number) => `Next ${n} days`,
    windowLabel: "Period",
    windowDays: (n: number) => `${n} days`,
    span: (from: string, to: string) => `${from} to ${to}`,
    viewLabel: "Calendar view",
    today: "Today",
    merged: (n: number) => `${n} merged PR${n === 1 ? "" : "s"}`,
    viewDay: "View this day",
    collapse: "Collapse",
  },
)
const pad = (n: number) => String(n).padStart(2, "0")
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const shortName = (repo: string) => repo.split("/").pop() ?? repo
const weekdays = () =>
  Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale(), {
      weekday: "short",
    }),
  )
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))

type View = "timeline" | "month" | "week" | "day"
const VIEWS: View[] = ["timeline", "month", "week", "day"]

/** Premier et dernier jour affichés pour une vue autour d'un jour d'ancrage (Fil : `days` jours jusqu'à lui). */
function range(view: View, anchor: Date, days: number): [Date, Date] {
  if (view === "timeline") return [addDays(anchor, 1 - days), anchor]
  if (view === "day") return [anchor, anchor]
  if (view === "week") return [monday(anchor), addDays(monday(anchor), 6)]
  return [
    new Date(anchor.getFullYear(), anchor.getMonth(), 1),
    new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
  ]
}

function heading(t: typeof S.fr, view: View, from: Date, to: Date) {
  if (view === "day")
    return capitalize(
      from.toLocaleDateString(locale(), {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    )
  if (view === "timeline")
    return t.span(
      from.toLocaleDateString(locale(), { day: "numeric", month: "short" }),
      to.toLocaleDateString(locale(), {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    )
  if (view === "week")
    return t.weekOf(
      from.toLocaleDateString(locale(), { day: "numeric", month: "short" }),
      to.toLocaleDateString(locale(), {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    )
  return capitalize(
    from.toLocaleDateString(locale(), { month: "long", year: "numeric" }),
  )
}

type Loaded = { key: string; prs: MergedPr[]; error?: string }

export function MergeCalendar() {
  const t = useStrings(S)
  const now = new Date()
  const todayKey = dayKey(now)
  const [view, setView] = useState<View>("timeline")
  const [days, setDays] = useState<number>(TIMELINE_DEFAULT_DAYS)
  const [viewBox, thumb] = useThumb<HTMLDivElement>(
    '[aria-pressed="true"]',
    view,
  )
  const [anchor, setAnchor] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  )
  const [data, setData] = useState<Loaded>({ key: "", prs: [] })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [first, last] = range(view, anchor, days)
  const timeline = view === "timeline"
  const from = dayKey(first)
  const to = dayKey(last)
  const rangeKey = `${from}..${to}`
  const loading = !timeline && data.key !== rangeKey
  const isCurrent = from <= todayKey && todayKey <= to

  useEffect(() => {
    if (timeline) return
    let stale = false
    const key = `${from}..${to}`
    mergedBetween(from, to)
      .then((r) => !stale && setData({ key, prs: r.prs, error: r.error }))
      .catch(
        (e: unknown) => !stale && setData({ key, prs: [], error: String(e) }),
      )
    return () => {
      stale = true
    }
  }, [from, to, timeline])

  const byDay = useMemo(() => {
    const map = new Map<string, MergedPr[]>()
    for (const pr of data.prs) {
      const k = dayKey(new Date(pr.mergedAt))
      map.set(k, [...(map.get(k) ?? []), pr])
    }
    return map
  }, [data.prs])

  const repos = useMemo(() => {
    const counts = new Map<string, number>()
    for (const pr of data.prs)
      counts.set(pr.repo, (counts.get(pr.repo) ?? 0) + 1)
    return [...counts].sort(([a], [b]) => a.localeCompare(b))
  }, [data.prs])
  const color = (repo: string) =>
    PALETTE[repos.findIndex(([r]) => r === repo) % PALETTE.length]

  // grille : semaines complètes du lundi au dimanche (mois) ou une seule semaine
  const gridStart = monday(first)
  const cells =
    view === "day"
      ? []
      : Array.from(
          {
            length:
              view === "week"
                ? 7
                : Math.ceil((((first.getDay() + 6) % 7) + last.getDate()) / 7) *
                  7,
          },
          (_, i) => addDays(gridStart, i),
        )

  const move = (delta: number) =>
    setAnchor((a) =>
      view === "month"
        ? new Date(a.getFullYear(), a.getMonth() + delta, 1)
        : view === "timeline"
          ? // pas au-delà d'aujourd'hui
            new Date(
              Math.min(
                addDays(a, delta * days).getTime(),
                new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  now.getDate(),
                ).getTime(),
              ),
            )
          : addDays(a, delta * (view === "week" ? 7 : 1)),
    )
  const openDay = (d: Date) => {
    setAnchor(d)
    setView("day")
  }
  const unit = t[view]
  const prevLabel = timeline
    ? t.prevWindow(days)
    : t.prev(unit, view === "week")
  const nextLabel = timeline
    ? t.nextWindow(days)
    : t.next(unit, view === "week")

  const pill = (pr: MergedPr) => (
    <a
      key={`${pr.repo}#${pr.number}`}
      href={pr.url}
      target="_blank"
      rel="noopener"
      title={`${pr.repo}#${pr.number} ${pr.title}`}
      className="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted"
    >
      <span className={cn("size-2 shrink-0 rounded-full", color(pr.repo))} />
      <span className="shrink-0 text-muted-foreground">#{pr.number}</span>
      <span className="min-w-0 truncate">{pr.title}</span>
    </a>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          ref={viewBox}
          role="group"
          aria-label={t.viewLabel}
          className="relative flex rounded-lg border p-0.5"
        >
          {thumb && (
            <span
              aria-hidden
              style={thumb}
              className="absolute rounded-md bg-secondary transition-[left,top,width,height] duration-200 ease-out motion-reduce:transition-none"
            />
          )}
          {VIEWS.map((v) => (
            <Button
              key={v}
              size="sm"
              variant="ghost"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                // pas de décalage au clic : la pilule, elle, ne bouge pas
                "relative active:not-aria-[haspopup]:translate-y-0",
                view === v &&
                  "text-secondary-foreground hover:bg-transparent hover:text-secondary-foreground dark:hover:bg-transparent",
              )}
            >
              {t[v]}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={prevLabel}
          onClick={() => move(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isCurrent}
          onClick={() =>
            setAnchor(
              new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            )
          }
        >
          {t.today}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={nextLabel}
          disabled={isCurrent}
          onClick={() => move(1)}
        >
          <ChevronRight />
        </Button>
        <h2 className="ml-1 text-lg font-semibold">
          {heading(t, view, first, last)}
        </h2>
        {timeline && (
          <span className="flex items-center gap-1">
            <span id="timeline-window" className="sr-only">
              {t.windowLabel}
            </span>
            <Select
              items={TIMELINE_WINDOWS.map((n) => ({
                value: n,
                label: t.windowDays(n),
              }))}
              value={days}
              onValueChange={(v) => v && setDays(v)}
            >
              <SelectTrigger
                size="sm"
                aria-labelledby="timeline-window"
                className="rounded-md bg-transparent px-2.5 font-medium hover:bg-muted dark:bg-transparent dark:hover:bg-muted/50"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                alignItemWithTrigger={false}
                align="start"
                className="rounded-xl p-1"
              >
                {TIMELINE_WINDOWS.map((n) => (
                  <SelectItem
                    key={n}
                    value={n}
                    className="rounded-lg py-1.5 pl-2.5 focus:bg-muted data-highlighted:bg-muted"
                  >
                    {t.windowDays(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TimelineLegend />
          </span>
        )}
        {loading && (
          <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
        )}
      </div>
      {timeline ? (
        <PrTimeline last={last} days={days} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t.merged(data.prs.length)}
            </span>
            {repos.map(([repo, n]) => (
              <Badge key={repo} variant="outline" title={repo}>
                <span className={cn("size-2 rounded-full", color(repo))} />
                {shortName(repo)} {n}
              </Badge>
            ))}
          </div>

          {data.error && (
            <p className="text-sm text-destructive">{data.error}</p>
          )}

          <div
            className={cn(
              "transition-opacity motion-reduce:transition-none",
              loading && "opacity-50",
            )}
          >
            {view === "day" ? (
              <ul className="flex flex-col divide-y rounded-lg border bg-card">
                {(byDay.get(from) ?? []).map((pr) => (
                  <li key={`${pr.repo}#${pr.number}`}>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener"
                      className="flex items-baseline gap-3 px-4 py-2.5 text-sm hover:bg-muted"
                    >
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {new Date(pr.mergedAt).toLocaleTimeString(locale(), {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                        <span
                          className={cn("size-2 rounded-full", color(pr.repo))}
                        />
                        {shortName(pr.repo)}#{pr.number}
                      </span>
                      <span className="min-w-0 flex-1">{pr.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border sm:grid">
                  {weekdays().map((w) => (
                    <div
                      key={w}
                      className="bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground"
                    >
                      {w}
                    </div>
                  ))}
                  {cells.map((d) => {
                    const k = dayKey(d)
                    const prs = byDay.get(k) ?? []
                    // la semaine a de la place : tout est affiché
                    const open = view === "week" || expanded.has(k)
                    const shown = open ? prs : prs.slice(0, MAX_VISIBLE)
                    return (
                      <div
                        key={k}
                        className={cn(
                          "flex min-w-0 flex-col gap-0.5 bg-card p-1",
                          view === "week" ? "min-h-64" : "min-h-24",
                          view === "month" &&
                            d.getMonth() !== first.getMonth() &&
                            "opacity-40",
                          k === todayKey && "ring-2 ring-primary ring-inset",
                        )}
                      >
                        <button
                          type="button"
                          title={t.viewDay}
                          onClick={() => openDay(d)}
                          className="self-start rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {view === "week"
                            ? d.toLocaleDateString(locale(), {
                                day: "numeric",
                                month: "short",
                              })
                            : d.getDate()}
                        </button>
                        {shown.map(pill)}
                        {!open && prs.length > MAX_VISIBLE && (
                          <button
                            type="button"
                            className="px-1 text-left text-xs text-primary hover:underline"
                            onClick={() =>
                              setExpanded((s) => new Set(s).add(k))
                            }
                          >
                            +{prs.length - MAX_VISIBLE}
                          </button>
                        )}
                        {view === "month" && expanded.has(k) && (
                          <button
                            type="button"
                            className="px-1 text-left text-xs text-primary hover:underline"
                            onClick={() =>
                              setExpanded((s) => {
                                const n = new Set(s)
                                n.delete(k)
                                return n
                              })
                            }
                          >
                            {t.collapse}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>

                <ul className="flex flex-col gap-3 sm:hidden">
                  {[...byDay]
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([k, prs]) => (
                      <li key={k} className="rounded-lg border bg-card p-2">
                        <div className="mb-1 text-xs font-medium text-muted-foreground">
                          {new Date(`${k}T00:00:00`).toLocaleDateString(
                            locale(),
                            {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                            },
                          )}
                        </div>
                        {prs.map(pill)}
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>

          {!loading &&
            !data.error &&
            (view === "day"
              ? !byDay.get(from)?.length
              : data.prs.length === 0) && (
              <p className="text-center text-sm text-muted-foreground">
                {
                  t[
                    view === "month"
                      ? "emptyMonth"
                      : view === "week"
                        ? "emptyWeek"
                        : "emptyDay"
                  ]
                }
              </p>
            )}
        </>
      )}
    </div>
  )
}
