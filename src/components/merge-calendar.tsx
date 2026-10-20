import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { cn } from "cn"
import { mergedBetween } from "@/lib/actions"
import type { MergedPr } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const PALETTE = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-cyan-500",
]
const MAX_VISIBLE = 3
const pad = (n: number) => String(n).padStart(2, "0")
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const shortName = (repo: string) => repo.split("/").pop() ?? repo
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2024, 0, 1 + i).toLocaleDateString("fr-FR", { weekday: "short" }),
)
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))

type View = "month" | "week" | "day"
const VIEWS: { id: View; label: string }[] = [
  { id: "month", label: "Mois" },
  { id: "week", label: "Semaine" },
  { id: "day", label: "Jour" },
]
const EMPTY: Record<View, string> = {
  month: "Aucune PR mergée ce mois-ci",
  week: "Aucune PR mergée cette semaine",
  day: "Aucune PR mergée ce jour-là",
}

/** Premier et dernier jour affichés pour une vue autour d'un jour d'ancrage. */
function range(view: View, anchor: Date): [Date, Date] {
  if (view === "day") return [anchor, anchor]
  if (view === "week") return [monday(anchor), addDays(monday(anchor), 6)]
  return [
    new Date(anchor.getFullYear(), anchor.getMonth(), 1),
    new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
  ]
}

function heading(view: View, from: Date, to: Date) {
  if (view === "day")
    return capitalize(
      from.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    )
  if (view === "week")
    return `Semaine du ${from.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} au ${to.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`
  return capitalize(
    from.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
  )
}

type Loaded = { key: string; prs: MergedPr[]; error?: string }

export function MergeCalendar() {
  const now = new Date()
  const todayKey = dayKey(now)
  const [view, setView] = useState<View>("month")
  const [anchor, setAnchor] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  )
  const [data, setData] = useState<Loaded>({ key: "", prs: [] })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [first, last] = range(view, anchor)
  const from = dayKey(first)
  const to = dayKey(last)
  const rangeKey = `${from}..${to}`
  const loading = data.key !== rangeKey
  const isCurrent = from <= todayKey && todayKey <= to

  useEffect(() => {
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
  }, [from, to])

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
        : addDays(a, delta * (view === "week" ? 7 : 1)),
    )
  const openDay = (d: Date) => {
    setAnchor(d)
    setView("day")
  }
  const unit = view === "month" ? "Mois" : view === "week" ? "Semaine" : "Jour"

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
          role="group"
          aria-label="Vue du calendrier"
          className="flex rounded-lg border p-0.5"
        >
          {VIEWS.map((v) => (
            <Button
              key={v.id}
              size="sm"
              variant={view === v.id ? "secondary" : "ghost"}
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`${unit} précédent${view === "week" ? "e" : ""}`}
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
          Aujourd&apos;hui
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`${unit} suivant${view === "week" ? "e" : ""}`}
          disabled={isCurrent}
          onClick={() => move(1)}
        >
          <ChevronRight />
        </Button>
        <h2 className="ml-1 text-lg font-semibold">
          {heading(view, first, last)}
        </h2>
        {loading && (
          <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {data.prs.length} PR mergée{data.prs.length > 1 ? "s" : ""}
        </span>
        {repos.map(([repo, n]) => (
          <Badge key={repo} variant="outline" title={repo}>
            <span className={cn("size-2 rounded-full", color(repo))} />
            {shortName(repo)} {n}
          </Badge>
        ))}
      </div>

      {data.error && <p className="text-sm text-destructive">{data.error}</p>}

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
                    {new Date(pr.mergedAt).toLocaleTimeString("fr-FR", {
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
              {WEEKDAYS.map((w) => (
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
                      title="Voir ce jour"
                      onClick={() => openDay(d)}
                      className="self-start rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {view === "week"
                        ? d.toLocaleDateString("fr-FR", {
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
                        onClick={() => setExpanded((s) => new Set(s).add(k))}
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
                        Réduire
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
                      {new Date(`${k}T00:00:00`).toLocaleDateString("fr-FR", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
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
        (view === "day" ? !byDay.get(from)?.length : data.prs.length === 0) && (
          <p className="text-center text-sm text-muted-foreground">
            {EMPTY[view]}
          </p>
        )}
    </div>
  )
}
