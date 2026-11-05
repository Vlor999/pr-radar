import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
  Check,
  Eye,
  EyeOff,
  GitMerge,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  RotateCcw,
  X,
} from "lucide-react"
import { cn } from "cn"

import { timelineBetween } from "@/lib/actions"
import {
  TIMELINE_LABEL_NARROW_PX,
  TIMELINE_LEGEND_W_PX,
  TIMELINE_LABEL_PX,
  TIMELINE_MIN_DAY_PX,
  TIMELINE_TIP_CLOSE_MS,
  TIMELINE_TOOLTIP_MAX,
} from "@/lib/constants"
import { locale, strings, useStrings } from "@/lib/i18n"
import { HOUR_MS } from "@/lib/quiet"
import { updateSettings, useSettings } from "@/lib/settings"
import { useMentionLookup } from "@/lib/slack"
import { slackParts } from "@/lib/slack-text"
import {
  layoutRow,
  toRows,
  windowOf,
  withSlack,
  type TimelineMarker,
  type TimelineRow,
} from "@/lib/timeline"
import {
  applyFilters,
  dropLastToken,
  filtersActive,
  highlight,
  NO_FILTERS,
  pickSuggestion,
  shortRepo,
  suggestions,
  type Suggestion,
  type TimelineFilters,
  type TimelineOwner,
} from "@/lib/timeline-filter"
import type { TimelineEvent, TimelinePr } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { SlackLogo } from "@/components/slack-logo"

const S = strings(
  {
    open: (d: string) => `ouverte ${d}`,
    draft: " · brouillon",
    mergedIn: (d: string) => `mergée en ${d}`,
    closed: "fermée",
    hours: (n: number) => `${n} h`,
    days: (n: number) => `${n} j`,
    inProgress: "En cours",
    finished: "Terminées",
    count: (open: number, done: number) =>
      `${open} en cours · ${done} terminées`,
    of: (n: number) => `(sur ${n})`,
    emptyWindow: "Aucune PR sur cette période",
    emptyFilters: "Aucune PR ne correspond aux filtres",
    today: "auj.",
    now: "Maintenant",
    placeholder: "Filtrer : titre, #numéro, repo",
    search: "Filtrer les PR",
    repos: "Repos",
    prs: "PR",
    recent: "Récentes",
    noSuggestion: "Aucune proposition",
    remove: (x: string) => `Retirer ${x}`,
    owner: "Auteur",
    owners: { all: "Tout le monde", mine: "Moi", others: "Les autres" },
    state: "État",
    states: {
      all: "Toutes",
      open: "En cours",
      merged: "Mergées",
      closed: "Fermées",
    },
    reset: "Réinitialiser",
    unhide: (n: number) => `Réafficher ${n} PR masquée${n > 1 ? "s" : ""}`,
    hide: "Masquer de la vue",
    hideLabel: (x: string) => `Masquer ${x} de la vue`,
    legend: "Légende",
    kinds: {
      start: "PR ouverte",
      slack: "Message Slack",
      approved: "Approuvée",
      changes: "Changements demandés",
      commented: "Review commentée",
      dismissed: "Review écartée",
      comment: "Commentaire",
      merge: "Mergée",
      close: "Fermée sans merge",
      reopen: "Rouverte",
      ready: "Prête pour review",
      cluster: "Plusieurs événements",
      pending: "Pas encore mergée aujourd'hui",
      draftLine: "Brouillon",
      gapLine: "Fermée, puis rouverte",
    },
    codeComments: (n: number) => `${n} commentaire${n > 1 ? "s" : ""} de code`,
    more: (n: number) => `+ ${n} autre${n > 1 ? "s" : ""}`,
    events: (n: number) => `${n} événements`,
    openSlack: "Ouvrir dans Slack",
    linksHint: "Entrée pour atteindre les liens",
  },
  {
    open: (d: string) => `open ${d}`,
    draft: " · draft",
    mergedIn: (d: string) => `merged in ${d}`,
    closed: "closed",
    hours: (n: number) => `${n}h`,
    days: (n: number) => `${n}d`,
    inProgress: "In progress",
    finished: "Finished",
    count: (open: number, done: number) =>
      `${open} in progress · ${done} finished`,
    of: (n: number) => `(of ${n})`,
    emptyWindow: "No PRs in this period",
    emptyFilters: "No PRs match the filters",
    today: "today",
    now: "Now",
    placeholder: "Filter: title, #number, repo",
    search: "Filter PRs",
    repos: "Repos",
    prs: "PRs",
    recent: "Recent",
    noSuggestion: "No suggestions",
    remove: (x: string) => `Remove ${x}`,
    owner: "Author",
    owners: { all: "Everyone", mine: "Me", others: "Others" },
    state: "State",
    states: {
      all: "All",
      open: "In progress",
      merged: "Merged",
      closed: "Closed",
    },
    reset: "Reset",
    unhide: (n: number) => `Show ${n} hidden PR${n === 1 ? "" : "s"}`,
    hide: "Hide from view",
    hideLabel: (x: string) => `Hide ${x} from view`,
    legend: "Legend",
    kinds: {
      start: "PR opened",
      slack: "Slack message",
      approved: "Approved",
      changes: "Changes requested",
      commented: "Review comments",
      dismissed: "Review dismissed",
      comment: "Comment",
      merge: "Merged",
      close: "Closed without merge",
      reopen: "Reopened",
      ready: "Ready for review",
      cluster: "Several events",
      pending: "Not merged yet today",
      draftLine: "Draft",
      gapLine: "Closed, then reopened",
    },
    codeComments: (n: number) => `${n} code comment${n === 1 ? "" : "s"}`,
    more: (n: number) => `+ ${n} more`,
    events: (n: number) => `${n} events`,
    openSlack: "Open in Slack",
    linksHint: "Enter to reach the links",
  },
)
type T = typeof S.fr

const OWNERS: TimelineOwner[] = ["all", "mine", "others"]
const STATES: TimelineFilters["status"][] = ["all", "open", "merged", "closed"]

const pad = (n: number) => String(n).padStart(2, "0")
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const duration = (t: T, ms: number) => {
  const h = Math.round(ms / HOUR_MS)
  return h < 24 ? t.hours(Math.max(h, 1)) : t.days(Math.round(h / 24))
}

const reviewKind = (e: TimelineEvent) =>
  e.review === "APPROVED"
    ? "approved"
    : e.review === "CHANGES_REQUESTED"
      ? "changes"
      : e.review === "DISMISSED"
        ? "dismissed"
        : "commented"

const title = (t: T, e: TimelineEvent) =>
  e.kind === "review"
    ? t.kinds[reviewKind(e)]
    : e.kind === "slack"
      ? `Slack · ${e.where ?? ""}`
      : t.kinds[e.kind]

/* ---------- Marqueurs ---------- */

const MARK =
  "absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-card transition-transform duration-150 ease-out outline-none hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"

/** Classes et icône d'un événement seul (ou de l'ancre d'un marqueur). */
function look(e: TimelineEvent): { className: string; icon: ReactNode } {
  const ico = "size-3"
  switch (e.kind) {
    case "start":
      return {
        className: "size-3 border-2 border-muted-foreground",
        icon: null,
      }
    case "slack":
      return {
        className: "size-5 border-border",
        icon: <SlackLogo className={ico} />,
      }
    case "review":
      return e.review === "APPROVED"
        ? {
            className:
              "size-5 border-green-600 text-green-600 dark:border-green-400 dark:text-green-400",
            icon: <Check className={ico} strokeWidth={2.5} />,
          }
        : e.review === "CHANGES_REQUESTED"
          ? {
              className:
                "size-5 border-amber-600 text-amber-600 dark:border-amber-400 dark:text-amber-400",
              icon: <Eye className={ico} strokeWidth={2.5} />,
            }
          : {
              className:
                "size-5 border-muted-foreground/60 text-muted-foreground",
              icon: <Eye className={ico} strokeWidth={2.5} />,
            }
    case "comment":
      return {
        className: "size-5 border-muted-foreground/60 text-muted-foreground",
        icon: <MessageSquare className={ico} strokeWidth={2.5} />,
      }
    case "reopen":
      return {
        className: "size-5 border-muted-foreground/60 text-foreground",
        icon: <RotateCcw className={ico} strokeWidth={2.5} />,
      }
    case "merge":
      return {
        className: "size-5.5 border-primary bg-primary text-primary-foreground",
        icon: <GitMerge className={ico} strokeWidth={2.5} />,
      }
    case "close":
      return {
        className: "size-5.5 border-destructive bg-destructive text-white",
        icon: <X className={ico} strokeWidth={2.5} />,
      }
    case "ready":
      return { className: "size-5", icon: null }
  }
}

/** `anchor` : marqueur d'origine (focus rendu à Échap) ; `focus` : ouverte au clavier, focus sur son 1er lien */
type Tip = {
  id: string
  items: TimelineEvent[]
  rect: DOMRect
  anchor: HTMLElement
  focus?: boolean
}

function Marker({
  m,
  id,
  t,
  onShow,
  onHide,
}: {
  m: TimelineMarker
  id: string
  t: T
  onShow: (tip: Tip) => void
  onHide: () => void
}) {
  const show = (el: HTMLElement, focus = false) =>
    onShow({
      id,
      items: m.items,
      rect: el.getBoundingClientRect(),
      anchor: el,
      focus,
    })
  const links = m.items.some((e) => e.permalink)
  const cluster = m.type === "cluster"
  const { className, icon } = look(m.lead)
  const label =
    m.items.length > 1
      ? `${cluster ? t.kinds.cluster : title(t, m.lead)} · ${t.events(m.items.length)}`
      : title(t, m.lead)
  return (
    <button
      type="button"
      aria-label={links ? `${label} · ${t.linksHint}` : label}
      aria-describedby={`${id}-tip`}
      // Entrée / Espace : focus dans l'info-bulle, pour atteindre le lien Slack au clavier
      onClick={(e) => links && show(e.currentTarget, true)}
      style={{ left: m.x }}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={onHide}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={onHide}
      onKeyDown={(e) => e.key === "Escape" && onHide()}
      className={cn(
        MARK,
        cluster
          ? "z-1 flex h-5.5 min-w-5.5 gap-0.5 rounded-sm border-muted-foreground/60 px-1.5 text-xs font-semibold text-foreground tabular-nums"
          : cn("z-1", className),
      )}
    >
      {cluster ? (
        <>
          <Layers className="size-3" strokeWidth={2.5} />
          {m.items.length}
        </>
      ) : (
        icon
      )}
      {!cluster && m.items.length > 1 && (
        <span className="absolute -top-2 -right-2.5 h-4 min-w-4 rounded-sm bg-card px-1 text-center text-xs leading-4 font-medium text-foreground tabular-nums ring-1 ring-foreground/15">
          {m.items.length}
        </span>
      )}
    </button>
  )
}

function TipItem({ e, t }: { e: TimelineEvent; t: T }) {
  const { icon } = look(e)
  const text =
    e.kind === "slack"
      ? slackParts(e.text ?? "")
          .map((p) => p.text)
          .join("")
      : e.text
  const meta = [
    e.who,
    e.threads ? t.codeComments(e.threads) : null,
    new Date(e.at).toLocaleString(locale(), {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  ].filter(Boolean)
  return (
    <div className="flex flex-col gap-0.5 not-first:mt-2 not-first:border-t not-first:pt-2">
      <div className="flex items-center gap-1.5 font-medium">
        <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5">
          {e.kind === "start" ? (
            <span className="size-2.5 rounded-full border-2 border-muted-foreground" />
          ) : e.kind === "merge" ? (
            <GitMerge className="text-primary" />
          ) : e.kind === "close" ? (
            <X className="text-destructive" />
          ) : (
            icon
          )}
        </span>
        <span className="min-w-0 truncate">{title(t, e)}</span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {meta.join(" · ")}
      </div>
      {text?.trim() && e.kind !== "start" && (
        <p className="mt-1 line-clamp-6 break-words whitespace-pre-wrap">
          {text.trim()}
        </p>
      )}
      {e.permalink && (
        <a
          href={e.permalink}
          target="_blank"
          rel="noopener"
          className="mt-1 self-start text-xs text-emerald-700 hover:underline dark:text-emerald-400"
        >
          {t.openSlack}
        </a>
      )}
    </div>
  )
}

function Tooltip({
  tip,
  t,
  onEnter,
  onLeave,
  onClose,
}: {
  tip: Tip
  t: T
  onEnter: () => void
  onLeave: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { rect } = tip
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(
      8,
      Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8),
    )
    let top = rect.bottom + 8
    if (top + h > innerHeight - 8) top = rect.top - h - 8
    setPos({ left, top: Math.max(8, top) })
    if (tip.focus) el.querySelector<HTMLElement>("a[href]")?.focus()
  }, [tip])
  const extra = tip.items.length - TIMELINE_TOOLTIP_MAX
  return (
    <div
      ref={ref}
      id={`${tip.id}-tip`}
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // focus dans l'info-bulle (lien Slack) : elle reste ouverte ; il en sort : elle se ferme
      onFocus={onEnter}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onLeave()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        tip.anchor.focus()
        onClose()
      }}
      style={pos ?? { left: -9999, top: 0 }}
      className="fixed z-50 max-h-96 w-max max-w-sm overflow-y-auto rounded-xl bg-popover p-3 text-sm text-popover-foreground shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10"
    >
      {tip.items.slice(0, TIMELINE_TOOLTIP_MAX).map((e, i) => (
        <TipItem key={i} e={e} t={t} />
      ))}
      {extra > 0 && (
        <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
          {t.more(extra)}
        </div>
      )}
    </div>
  )
}

/* ---------- Légende ---------- */

export function TimelineLegend() {
  const t = useStrings(S)
  const dot = (e: TimelineEvent) => {
    const { className, icon } = look(e)
    return (
      <span
        className={cn(
          "grid place-items-center rounded-full border bg-card",
          className,
        )}
      >
        {icon}
      </span>
    )
  }
  const items: [ReactNode, string][] = [
    [dot({ kind: "start", at: "" }), t.kinds.start],
    [dot({ kind: "slack", at: "" }), t.kinds.slack],
    [dot({ kind: "review", review: "APPROVED", at: "" }), t.kinds.approved],
    [
      dot({ kind: "review", review: "CHANGES_REQUESTED", at: "" }),
      t.kinds.changes,
    ],
    [dot({ kind: "review", review: "COMMENTED", at: "" }), t.kinds.commented],
    [dot({ kind: "comment", at: "" }), t.kinds.comment],
    [dot({ kind: "reopen", at: "" }), t.kinds.reopen],
    [dot({ kind: "merge", at: "" }), t.kinds.merge],
    [dot({ kind: "close", at: "" }), t.kinds.close],
    [
      <span className="flex h-5.5 items-center gap-0.5 rounded-sm border border-muted-foreground/60 bg-card px-1.5 text-xs font-semibold tabular-nums">
        <Layers className="size-3" strokeWidth={2.5} />3
      </span>,
      t.kinds.cluster,
    ],
    [
      <span className="block w-7 border-t-2 border-dotted border-muted-foreground" />,
      t.kinds.draftLine,
    ],
    [
      <span className="block w-7 border-t-2 border-dotted border-destructive/60" />,
      t.kinds.gapLine,
    ],
    [
      <span className="block h-4 w-7 rounded-sm border border-dashed border-primary/45 bg-primary/15 dark:border-primary/70 dark:bg-primary/25" />,
      t.kinds.pending,
    ],
  ]
  // place à droite de l'icône insuffisante (fin de la barre) : la légende s'aligne sur son bord droit
  const [end, setEnd] = useState(false)
  const place = (el: HTMLElement) =>
    setEnd(
      el.getBoundingClientRect().left + TIMELINE_LEGEND_W_PX + 8 > innerWidth,
    )
  return (
    <div
      className="group relative inline-flex"
      onMouseEnter={(e) => place(e.currentTarget)}
      onFocus={(e) => place(e.currentTarget)}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t.legend}
        aria-describedby="timeline-legend"
        className="cursor-help text-muted-foreground"
      >
        <Info />
      </Button>
      <div
        id="timeline-legend"
        role="tooltip"
        className={cn(
          "invisible absolute top-full z-50 mt-1.5 flex w-64 -translate-y-1 flex-col gap-2 rounded-xl bg-popover p-3 text-sm text-popover-foreground opacity-0 shadow-sm ring-1 ring-foreground/5 transition-[opacity,transform,visibility] duration-150 ease-out group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transition-none dark:ring-foreground/10",
          end ? "right-0" : "left-0",
        )}
      >
        {items.map(([m, label]) => (
          <span key={label} className="flex items-center gap-2">
            <span className="flex w-8 shrink-0 justify-center">{m}</span>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------- Recherche ---------- */

function Marked({ text, q }: { text: string; q: string }) {
  const h = highlight(text, q)
  if (!h) return <>{text}</>
  return (
    <>
      {h[0]}
      <mark className="rounded-sm bg-primary/20 text-inherit">{h[1]}</mark>
      {h[2]}
    </>
  )
}

function SearchField({
  pool,
  filters,
  setFilters,
  t,
}: {
  pool: TimelineRow[]
  filters: TimelineFilters
  setFilters: (f: TimelineFilters) => void
  t: T
}) {
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState(0)
  const [pendingDel, setPendingDel] = useState(false)
  const opts = useMemo(
    () => suggestions(pool, filters.q, filters),
    [pool, filters],
  )
  const active = Math.min(cur, opts.length - 1)
  const tokens = [
    ...filters.repos.map((r) => ({
      kind: "repo" as const,
      v: r,
      text: shortRepo(r),
    })),
    ...filters.prs.map((k) => {
      const p = pool.find((r) => r.key === k)
      return {
        kind: "pr" as const,
        v: k,
        text: p ? `${shortRepo(p.repo)} #${p.number}` : k,
      }
    }),
  ]
  const pick = (s: Suggestion) => setFilters(pickSuggestion(filters, s))
  const removeToken = (kind: "repo" | "pr", v: string) =>
    setFilters(
      kind === "repo"
        ? { ...filters, repos: filters.repos.filter((x) => x !== v) }
        : { ...filters, prs: filters.prs.filter((x) => x !== v) },
    )

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Backspace" && pendingDel) setPendingDel(false)
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (!open) setOpen(true)
      else setCur(Math.min(active + 1, opts.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setCur(Math.max(active - 1, 0))
    } else if (e.key === "Enter" && open && opts[active]) {
      e.preventDefault()
      pick(opts[active])
    } else if (e.key === "Escape") setOpen(false)
    else if (e.key === "Backspace" && !filters.q && tokens.length) {
      if (!pendingDel) return setPendingDel(true)
      setPendingDel(false)
      setFilters(dropLastToken(filters))
    }
  }

  // option active toujours visible quand ↑ / ↓ fait défiler la liste
  useEffect(() => {
    if (open)
      document
        .getElementById(`timeline-opt-${active}`)
        ?.scrollIntoView({ block: "nearest" })
  }, [open, active])

  let lastType: Suggestion["type"] | null = null
  return (
    <div className="relative w-full max-w-sm">
      <div
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault()
            input.current?.focus()
          }
        }}
        className="flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 dark:bg-input/30"
      >
        {tokens.map((tk, i) => (
          <span
            key={tk.v}
            title={tk.v}
            className={cn(
              "inline-flex max-w-full items-center gap-0.5 rounded-sm bg-muted py-0.5 pr-0.5 pl-1.5 font-mono text-xs whitespace-nowrap",
              pendingDel &&
                i === tokens.length - 1 &&
                "ring-2 ring-foreground/30",
            )}
          >
            <span className="truncate">{tk.text}</span>
            <button
              type="button"
              aria-label={t.remove(tk.text)}
              onMouseDown={(e) => {
                e.preventDefault()
                removeToken(tk.kind, tk.v)
              }}
              className="grid size-4 place-items-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={t.search}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? "timeline-suggestions" : undefined}
          aria-activedescendant={
            open && opts[active] ? `timeline-opt-${active}` : undefined
          }
          autoComplete="off"
          value={filters.q}
          placeholder={tokens.length ? "" : t.placeholder}
          onChange={(e) => {
            setFilters({ ...filters, q: e.target.value })
            setCur(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setPendingDel(false)
          }}
          onKeyDown={onKey}
          className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {open && (
        <ul
          id="timeline-suggestions"
          role="listbox"
          aria-multiselectable="true"
          aria-label={t.search}
          className="absolute top-full left-0 z-40 mt-1 max-h-96 w-full overflow-y-auto rounded-xl bg-popover p-1 text-sm text-popover-foreground shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10"
        >
          {!opts.length && (
            <li className="px-2 py-2 text-muted-foreground">
              {t.noSuggestion}
            </li>
          )}
          {opts.map((o, i) => {
            const head =
              o.type !== lastType ? (
                <li
                  role="presentation"
                  className="px-2 pt-1.5 pb-0.5 text-xs text-muted-foreground"
                >
                  {o.type === "repo" ? t.repos : filters.q ? t.prs : t.recent}
                </li>
              ) : null
            lastType = o.type
            return (
              <li
                key={o.type === "repo" ? o.repo : o.row.key}
                role="presentation"
              >
                <ul role="presentation">
                  {head}
                  <li
                    id={`timeline-opt-${i}`}
                    role="option"
                    aria-selected={o.selected}
                    data-active={i === active || undefined}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pick(o)
                    }}
                    onMouseMove={() => i !== active && setCur(i)}
                    className="flex min-w-0 cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 data-active:bg-muted"
                  >
                    <span className="size-3.5 shrink-0 self-center text-primary">
                      {o.selected && <Check className="size-3.5" />}
                    </span>
                    {o.type === "repo" ? (
                      <>
                        <span className="min-w-0 truncate font-mono">
                          <Marked text={o.repo} q={filters.q} />
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                          {o.count} PR
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          <Marked text={shortRepo(o.row.repo)} q={filters.q} />{" "}
                          #
                          <Marked text={String(o.row.number)} q={filters.q} />
                        </span>
                        <span className="min-w-0 truncate">
                          <Marked text={o.row.title} q={filters.q} />
                        </span>
                      </>
                    )}
                  </li>
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ---------- Vue ---------- */

type Loaded = { key: string; prs: TimelinePr[]; at: number; error?: string }

/** Vue Fil : `days` journées jusqu'à `last` incluse. */
export function PrTimeline({ last, days }: { last: Date; days: number }) {
  const t = useStrings(S)
  const { timelineHidden: hidden } = useSettings()
  const mentionsOf = useMentionLookup()
  const first = new Date(
    last.getFullYear(),
    last.getMonth(),
    last.getDate() - days + 1,
  )
  const from = dayKey(first)
  const to = dayKey(last)
  const key = `${from}..${to}`
  const [data, setData] = useState<Loaded>({ key: "", prs: [], at: Date.now() })
  const [filters, setFilters] = useState<TimelineFilters>(NO_FILTERS)
  const [tip, setTip] = useState<Tip | null>(null)
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined)
  const scroller = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, narrow: false })
  const loading = data.key !== key

  useEffect(() => {
    let stale = false
    timelineBetween(from, to)
      .then(
        (r) =>
          !stale &&
          setData({ key, prs: r.prs, error: r.error, at: Date.now() }),
      )
      .catch(
        (e: unknown) =>
          !stale && setData({ key, prs: [], error: String(e), at: Date.now() }),
      )
    return () => {
      stale = true
    }
  }, [from, to, key])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () =>
      setBox((b) => {
        const next = {
          width: el.clientWidth,
          narrow: window.matchMedia("(max-width: 640px)").matches,
        }
        return b.width === next.width && b.narrow === next.narrow ? b : next
      })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const w = useMemo(
    () => windowOf(new Date(`${to}T00:00:00`), days, data.at),
    [to, days, data.at],
  )
  const rows = useMemo(
    () =>
      toRows(
        data.prs.map((p) => withSlack(p, mentionsOf(p.url))),
        w,
      ),
    [data.prs, mentionsOf, w],
  )
  const pool = useMemo(
    () => rows.filter((r) => !hidden.includes(r.key)),
    [rows, hidden],
  )
  const shown = useMemo(
    () => applyFilters(rows, filters, hidden),
    [rows, filters, hidden],
  )
  const hiddenHere = rows.length - pool.length
  const active = filtersActive(filters)

  const labelW = box.narrow ? TIMELINE_LABEL_NARROW_PX : TIMELINE_LABEL_PX
  const dayW = Math.max(
    Math.floor((box.width - labelW) / days),
    TIMELINE_MIN_DAY_PX,
  )
  const W = dayW * days
  const x = (ms: number) => ((ms - w.start) / (w.end - w.start)) * W
  const nowX = x(w.now)

  // la fin de la fenêtre (aujourd'hui) en vue
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [W, shown.length, key])

  const showTip = (next: Tip) => {
    clearTimeout(closing.current)
    setTip(next)
  }
  const hideTip = () => {
    clearTimeout(closing.current)
    closing.current = setTimeout(() => setTip(null), TIMELINE_TIP_CLOSE_MS)
  }
  useEffect(() => () => clearTimeout(closing.current), [])

  const dayCols = Array.from({ length: days }, (_, i) => {
    const d = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate() + i,
    )
    const today = dayKey(d) === dayKey(new Date(w.now))
    return { d, i, today, weekend: d.getDay() === 0 || d.getDay() === 6 }
  })
  const columns = (labels: boolean) =>
    dayCols.map(({ d, i, today, weekend }) => (
      <div
        key={i}
        aria-hidden={!labels || undefined}
        style={{ left: i * dayW, width: dayW }}
        className={cn(
          "absolute inset-y-0 border-l",
          weekend && "bg-muted/50",
          today && "bg-primary/5",
        )}
      >
        {labels && (
          <div className="absolute inset-x-0 top-1 text-center text-xs leading-tight text-muted-foreground tabular-nums">
            {today
              ? t.today
              : d.toLocaleDateString(locale(), { weekday: "narrow" })}
            <b
              className={cn(
                "block font-medium text-foreground",
                today && "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {d.getDate()}
            </b>
          </div>
        )}
      </div>
    ))

  const status = (r: TimelineRow) =>
    r.status === "merged" ? (
      <span className="text-emerald-700 dark:text-emerald-400">
        {t.mergedIn(duration(t, r.tEnd - r.t0))}
      </span>
    ) : r.status === "closed" ? (
      <span className="text-destructive">{t.closed}</span>
    ) : (
      <span>
        {t.open(duration(t, w.now - r.t0))}
        {r.draft && t.draft}
      </span>
    )

  const line = (r: TimelineRow) => {
    const l = layoutRow(r, w, W)
    return (
      <>
        {l.segments.map((s, i) => (
          <div
            key={i}
            style={{ left: s.from, width: s.to - s.from }}
            className={cn(
              "absolute top-1/2 h-0.5 -translate-y-1/2",
              s.kind === "solid" && "rounded-full bg-muted-foreground/50",
              s.kind === "fade" &&
                "bg-linear-to-r from-transparent to-muted-foreground/50",
              s.kind !== "solid" && s.kind !== "fade" && "bg-card",
            )}
          >
            {(s.kind === "draft" || s.kind === "gap") && (
              <div
                className={cn(
                  "border-t-2 border-dotted",
                  s.kind === "draft"
                    ? "border-muted-foreground/60"
                    : "border-destructive/60",
                )}
              />
            )}
          </div>
        ))}
        {l.pending && (
          <div
            style={{
              left: l.pending.from,
              width: Math.max(l.pending.to - l.pending.from, 0),
            }}
            className="absolute top-1/2 h-4.5 -translate-y-1/2 rounded-sm border border-dashed border-primary/45 bg-primary/15 dark:border-primary/70 dark:bg-primary/25"
          />
        )}
        {l.markers.map((m, i) => (
          <Marker
            key={i}
            m={m}
            id={`tl-${r.key}-${i}`.replace(/[^\w-]/g, "-")}
            t={t}
            onShow={showTip}
            onHide={hideTip}
          />
        ))}
      </>
    )
  }

  const finishedCount = shown.filter((r) => r.finished).length
  let lastGroup: boolean | null = null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          pool={pool}
          filters={filters}
          setFilters={setFilters}
          t={t}
        />
        <div role="group" aria-label={t.owner} className="flex flex-wrap gap-1">
          {OWNERS.map((o) => (
            <Button
              key={o}
              size="xs"
              variant={filters.owner === o ? "default" : "outline"}
              aria-pressed={filters.owner === o}
              onClick={() => setFilters({ ...filters, owner: o })}
            >
              {t.owners[o]}
            </Button>
          ))}
        </div>
        <div role="group" aria-label={t.state} className="flex flex-wrap gap-1">
          {STATES.map((s) => (
            <Button
              key={s}
              size="xs"
              variant={filters.status === s ? "default" : "outline"}
              aria-pressed={filters.status === s}
              onClick={() => setFilters({ ...filters, status: s })}
            >
              {t.states[s]}
            </Button>
          ))}
        </div>
        {active && (
          <button
            type="button"
            onClick={() => setFilters(NO_FILTERS)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {t.reset}
          </button>
        )}
        {hiddenHere > 0 && (
          <button
            type="button"
            onClick={() =>
              updateSettings({
                timelineHidden: hidden.filter(
                  (k) => !rows.some((r) => r.key === k),
                ),
              })
            }
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {t.unhide(hiddenHere)}
          </button>
        )}
        {loading && (
          <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
        )}
      </div>

      {data.error && <p className="text-sm text-destructive">{data.error}</p>}

      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-card transition-opacity duration-150 motion-reduce:transition-none",
          loading && "opacity-50",
        )}
      >
        <div ref={scroller} className="overflow-x-auto">
          {!shown.length ? (
            !loading && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {rows.length ? t.emptyFilters : t.emptyWindow}
              </p>
            )
          ) : (
            <div className="relative w-max min-w-full">
              <div className="flex">
                <div
                  style={{ width: labelW, flexBasis: labelW }}
                  className="sticky left-0 z-3 flex shrink-0 items-center border-r bg-card px-3 py-1.5 text-xs text-muted-foreground tabular-nums"
                >
                  {t.count(shown.length - finishedCount, finishedCount)}
                  {(active || hiddenHere > 0) && (
                    <span className="ml-1 opacity-70">{t.of(rows.length)}</span>
                  )}
                </div>
                <div style={{ width: W }} className="relative h-10 shrink-0">
                  {columns(true)}
                </div>
              </div>
              {shown.map((r) => {
                const group =
                  r.finished !== lastGroup ? (
                    <div className="flex border-t bg-muted text-xs font-medium text-muted-foreground">
                      <div
                        style={{ width: labelW, flexBasis: labelW }}
                        className="sticky left-0 z-3 shrink-0 bg-muted px-3 py-1"
                      >
                        {r.finished ? t.finished : t.inProgress}
                      </div>
                      <div style={{ width: W }} className="shrink-0" />
                    </div>
                  ) : null
                lastGroup = r.finished
                const ref = `${shortRepo(r.repo)} #${r.number}`
                return (
                  <div key={r.key}>
                    {group}
                    <div className="group/row flex border-t">
                      <div
                        style={{ width: labelW, flexBasis: labelW }}
                        className="sticky left-0 z-3 flex min-w-0 shrink-0 items-center gap-1 border-r bg-card py-2 pr-1 pl-3"
                      >
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener"
                          title={`${r.repo}#${r.number} ${r.title}`}
                          className="group/link flex min-w-0 flex-1 flex-col rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="flex items-baseline gap-2 text-xs whitespace-nowrap text-muted-foreground">
                            <span className="min-w-0 truncate font-mono">
                              {ref}
                              {!r.mine && (
                                <span className="font-sans"> · {r.author}</span>
                              )}
                            </span>
                            <span className="ml-auto shrink-0 tabular-nums">
                              {status(r)}
                            </span>
                          </span>
                          <span className="truncate text-sm group-hover/link:underline">
                            {r.title}
                          </span>
                        </a>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={t.hide}
                          aria-label={t.hideLabel(ref)}
                          onClick={() => {
                            setTip(null)
                            updateSettings({
                              timelineHidden: [...hidden, r.key],
                            })
                          }}
                          className="shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                        >
                          <EyeOff />
                        </Button>
                      </div>
                      <div
                        style={{ width: W }}
                        className="relative h-13 shrink-0"
                      >
                        {columns(false)}
                        {line(r)}
                      </div>
                    </div>
                  </div>
                )
              })}
              {nowX >= 0 && nowX <= W && (
                <div
                  title={t.now}
                  aria-hidden
                  style={{ left: labelW + nowX }}
                  className="pointer-events-none absolute inset-y-0 z-2 border-l border-dashed border-primary dark:border-emerald-400/70"
                />
              )}
            </div>
          )}
        </div>
      </div>
      {tip && (
        <Tooltip
          tip={tip}
          t={t}
          onEnter={() => clearTimeout(closing.current)}
          onLeave={hideTip}
          onClose={() => {
            clearTimeout(closing.current)
            setTip(null)
          }}
        />
      )}
    </div>
  )
}
