import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react"
import {
  CalendarDays,
  CheckCheck,
  Eye,
  GitPullRequest,
  PanelLeft,
  Plug,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  TriangleAlert,
  X,
} from "lucide-react"
import { cn } from "cn"

import { refreshPrs } from "@/lib/actions"
import { locale, pick, strings, useStrings } from "@/lib/i18n"
import { MergeCalendar } from "@/components/merge-calendar"
import { plural } from "@/components/pr-card"
import { RepoSidebar } from "@/components/repo-sidebar"
import { ReviewList } from "@/components/review-list"
import { UpdateBanner } from "@/components/update-banner"
import { RunningDot } from "@/components/running-dot"
import { WebMenu } from "@/components/web-menu"
import { checkForUpdate, useUpdate } from "@/lib/updater"
import { invoke, isWeb, listen } from "@/lib/platform"
import { useAutoInterval } from "@/lib/quota"
import { getSettings, useSettings } from "@/lib/settings"
import { refreshMentions, useSlack } from "@/lib/slack"
import { useMcp } from "@/lib/mcp"
import { openWeb, startErrorText, toggleWeb, WEB_ERRORS } from "@/lib/web"
import { RepoSection, type OpenState } from "@/components/repo-section"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { SHORTCUTS, useKeyboardNav } from "@/hooks/use-keyboard-nav"
import {
  usePrNotifications,
  useReviewNotifications,
} from "@/hooks/use-pr-notifications"
import { formatUntil, pause, resume, useQuiet } from "@/hooks/use-quiet"
import { useSeen } from "@/hooks/use-seen"
import { useThumb } from "@/hooks/use-thumb"
import {
  descendants,
  filterTree,
  isStacked,
  isStale,
  mergeState,
  needsAttention,
  sortTree,
} from "@/lib/tree"
import { reviewCount, type Reviews } from "@/lib/review"
import type { Pr, PrNode, RepoTree, WebStatus } from "@/lib/types"

const S = strings(
  {
    tabs: {
      open: "PR ouvertes",
      review: "À reviewer",
      calendar: "Calendrier des merges",
    },
    reviewCount: (n: number) => `${n} demandée${n > 1 ? "s" : ""} à toi`,
    filters: {
      all: "Toutes",
      attention: "À traiter",
      ready: "Prêtes à merger",
      approved: "Approuvées",
      stacked: "Stackées",
      draft: "Draft",
      ci: "CI rouge",
      stale: "Inactives",
    },
    sorts: {
      priority: "Priorité",
      oldest: "Plus anciennes",
      recent: "Plus récentes",
    },
    trackedRepos: "Repos suivis",
    myOpenPrs: "Mes PR ouvertes",
    updatedAt: (time: string) => `mis à jour ${time}`,
    auto: (min: number) => `auto toutes les ${min} min`,
    autoMode: (min: number) => `Auto (${min} min)`,
    manual: "actualisation manuelle",
    refreshing: "Rafraîchissement…",
    refresh: "Rafraîchir",
    settings: "Réglages",
    settingsUpdate: (v: string) => `Réglages (version ${v} disponible)`,
    settingsTitleUpdate: (v: string) => `Réglages · version ${v} disponible`,
    settingsTitle: "Réglages (⌘,)",
    mcp: "Serveur MCP",
    mcpOn: "Serveur MCP (actif)",
    webSettings: "Réglages de la version web",
    dismiss: "Fermer",
    view: "Vue",
    fetchFailed: (e: string) => `Récupération GitHub en échec : ${e}`,
    searchPlaceholder: "Repo, titre, branche, #numéro",
    search: "Rechercher",
    filterByStatus: "Filtrer par statut",
    sort: "Tri",
    markAllSeen: (n: number) => `Tout marquer comme vu (${n})`,
    expandAll: "Tout déplier",
    collapseAll: "Tout replier",
    noRepos:
      "Aucun repo suivi. Coche des repos dans le panneau « Repos suivis ».",
    noMatch: "Aucune PR ne correspond à la recherche.",
    repo: "repo",
    tray: {
      tooltip: (n: number) => `PR Radar : ${n} PR à traiter`,
      open: "Ouvrir PR Radar",
      quit: "Quitter",
      web: "Ouvrir dans le navigateur",
      pauseHour: "Pause des notifications pendant 1 heure",
      pauseTomorrow: "Pause des notifications jusqu'à demain",
      paused: (until: string) => `Notifications en pause jusqu'à ${until}`,
      resume: "Reprendre les notifications",
    },
  },
  {
    tabs: { open: "Open PRs", review: "To review", calendar: "Merge calendar" },
    reviewCount: (n: number) => `${n} requested from you`,
    filters: {
      all: "All",
      attention: "Needs action",
      ready: "Ready to merge",
      approved: "Approved",
      stacked: "Stacked",
      draft: "Draft",
      ci: "CI failing",
      stale: "Stale",
    },
    sorts: {
      priority: "Priority",
      oldest: "Oldest",
      recent: "Most recent",
    },
    trackedRepos: "Tracked repos",
    myOpenPrs: "My open PRs",
    updatedAt: (time: string) => `updated ${time}`,
    auto: (min: number) => `auto every ${min} min`,
    autoMode: (min: number) => `Auto (${min} min)`,
    manual: "manual refresh",
    refreshing: "Refreshing…",
    refresh: "Refresh",
    settings: "Settings",
    settingsUpdate: (v: string) => `Settings (version ${v} available)`,
    settingsTitleUpdate: (v: string) => `Settings · version ${v} available`,
    settingsTitle: "Settings (⌘,)",
    mcp: "MCP server",
    mcpOn: "MCP server (on)",
    webSettings: "Web version settings",
    dismiss: "Dismiss",
    view: "View",
    fetchFailed: (e: string) => `GitHub fetch failed: ${e}`,
    searchPlaceholder: "Repo, title, branch, #number",
    search: "Search",
    filterByStatus: "Filter by status",
    sort: "Sort",
    markAllSeen: (n: number) => `Mark all as seen (${n})`,
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    noRepos: "No tracked repos. Tick repos in the “Tracked repos” panel.",
    noMatch: "No PRs match the search.",
    repo: "repo",
    tray: {
      tooltip: (n: number) =>
        `PR Radar: ${n} PR${n > 1 ? "s" : ""} need action`,
      open: "Open PR Radar",
      quit: "Quit",
      web: "Open in browser",
      pauseHour: "Pause notifications for 1 hour",
      pauseTomorrow: "Pause notifications until tomorrow",
      paused: (until: string) => `Notifications paused until ${until}`,
      resume: "Resume notifications",
    },
  },
)

/** Libellés du menu de l'icône (src-tauri `TrayLabels`) : état de la pause, puis « Reprendre » ou les choix de pause. */
const trayLabels = (
  tray: (typeof S)["fr"]["tray"],
  paused: string | null,
  manual: boolean,
) => ({
  open: tray.open,
  quit: tray.quit,
  web: tray.web,
  pauseHour: tray.pauseHour,
  pauseTomorrow: tray.pauseTomorrow,
  paused,
  resume: manual ? tray.resume : null,
})

// réglages, serveur MCP et version web : ouverts à la demande, chargés dans leur propre chunk
const SettingsPage = lazy(() =>
  import("@/components/settings-page").then((m) => ({
    default: m.SettingsPage,
  })),
)
const McpPage = lazy(() =>
  import("@/components/mcp-page").then((m) => ({ default: m.McpPage })),
)
const WebPage = lazy(() =>
  import("@/components/web-page").then((m) => ({ default: m.WebPage })),
)

const TABS = [
  { id: "open", icon: GitPullRequest },
  { id: "review", icon: Eye },
  { id: "calendar", icon: CalendarDays },
] as const

const FILTERS: {
  id: keyof typeof S.fr.filters
  match: (p: PrNode) => boolean
}[] = [
  { id: "all", match: () => true },
  { id: "attention", match: needsAttention },
  {
    id: "ready",

    match: (p) => mergeState(p)?.kind === "ready",
  },
  {
    id: "approved",

    match: (p) => p.decision === "APPROVED",
  },
  { id: "stacked", match: isStacked },
  { id: "draft", match: (p) => p.draft },
  {
    id: "ci",

    match: (p) => p.ci === "FAILURE" || p.ci === "ERROR",
  },
  {
    id: "stale",

    match: (p) => isStale(p, Date.now(), getSettings().staleDays),
  },
]

const SORTS: {
  id: keyof typeof S.fr.sorts
  cmp?: (a: Pr, b: Pr) => number
}[] = [
  { id: "priority" }, // ordre déjà calculé par buildTree
  {
    id: "oldest",
    cmp: (a, b) => Date.parse(a.updated) - Date.parse(b.updated),
  },
  {
    id: "recent",
    cmp: (a, b) => Date.parse(b.updated) - Date.parse(a.updated),
  },
]

export function PrDashboard({
  prs,
  trees,
  withPrs,
  reviews,
  fetchedAt,
  error,
}: {
  prs: Pr[]
  trees: RepoTree[]
  withPrs: string[]
  reviews: Reviews
  fetchedAt: string
  error?: string
}) {
  const t = useStrings(S)
  const wide = useWide()
  const [reposOpen, setReposOpen] = useState(false)
  const [refreshing, startRefresh] = useTransition()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<keyof typeof S.fr.filters>("all")
  const settings = useSettings()
  const [sort, setSort] = useState<string>(() => getSettings().defaultSort)
  // page plein écran affichée à la place du tableau de bord
  const [page, setPage] = useState<"settings" | "mcp" | "web" | null>(null)
  const toggle = (p: NonNullable<typeof page>) =>
    setPage((v) => (v === p ? null : p))
  const [webError, setWebError] = useState<string | null>(null)
  const [webBusy, setWebBusy] = useState(false)
  const webErrors = useStrings(WEB_ERRORS)
  const mcp = useMcp()
  const updateState = useUpdate()
  const update = updateState.status === "available" ? updateState.version : null
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("open")
  // la barre d'onglets disparaît pendant les réglages : re-mesurer à son retour
  const [tabBox, underline] = useThumb<HTMLElement>(
    '[aria-selected="true"]',
    `${tab}:${page}`,
  )
  usePrNotifications(prs)
  useReviewNotifications(reviews)
  const toReview = reviewCount(reviews.reviews)
  // icône de la barre des menus : PR « À traiter » (même filtre que l'onglet)
  const attention = prs.filter(needsAttention).length
  const quiet = useQuiet()
  const pausedText =
    quiet.until && t.tray.paused(formatUntil(quiet.until, quiet.zone))
  useEffect(() => {
    if (isWeb) return // icône de l'app : tenue par la fenêtre de l'app
    invoke("set_tray", {
      count: attention,
      tooltip: t.tray.tooltip(attention),
      labels: trayLabels(t.tray, pausedText, quiet.manual),
    }).catch(() => {})
  }, [attention, t, pausedText, quiet.manual])
  // choix « Ne pas déranger » du menu de l'icône
  useEffect(() => {
    const off = listen<string>("tray-pause", ({ payload }) =>
      payload === "resume"
        ? resume()
        : pause(payload === "tomorrow" ? "tomorrow" : "hour"),
    )
    return () => void off.then((f) => f())
  }, [])
  // déconnexion (le tableau de bord disparaît) : plus de compteur
  useEffect(
    () => () => {
      if (isWeb) return
      invoke("set_tray", {
        count: 0,
        tooltip: "PR Radar",
        labels: trayLabels(pick(S).tray, null, false),
      }).catch(() => {})
    },
    [],
  )
  const seen = useSeen(prs)
  useKeyboardNav()
  const shortcuts = useStrings(SHORTCUTS)

  // l'état déplié/replié survit aux rafraîchissements (le composant n'est pas remonté)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // objet stable : les RepoSection (memo) ne se re-rendent que si leur repo ou cet état change
  const state = useMemo<OpenState>(
    () => ({
      isOpen: (k, fallback) => open[k] ?? fallback,
      toggle: (k, v) => setOpen((o) => ({ ...o, [k]: v })),
      isNew: seen.isNew,
      markSeen: seen.markSeen,
    }),
    [open, seen.isNew, seen.markSeen],
  )

  // mentions Slack : relues avec chaque actualisation GitHub (cache 10 min par PR). Dépendances : seulement
  // ce qui change la recherche, pas l'état Slack entier (une erreur affichée ne doit pas relancer la file).
  const { team: slackTeam, expired: slackExpired } = useSlack()
  const slackTeamId = slackTeam?.id
  useEffect(
    () => refreshMentions(prs),
    [prs, slackTeamId, slackExpired, settings.slackAll, settings.slackChannels],
  )

  // actualisation automatique (0 = manuelle, "auto" = selon le quota) et au retour sur la fenêtre.
  // setTimeout relancé à la fin de chaque actualisation (auto, manuelle, au focus) : le délai repart de là.
  const autoMs = useAutoInterval()
  const intervalMs =
    settings.refreshMinutes === "auto"
      ? autoMs
      : settings.refreshMinutes * 60_000
  // version web : pas d'actualisation automatique tant que l'onglet est caché (l'app, elle, continue)
  const paused = useHidden() && isWeb
  useEffect(() => {
    if (!intervalMs || refreshing || paused) return
    const id = setTimeout(() => startRefresh(() => refreshPrs()), intervalMs)
    return () => clearTimeout(id)
  }, [intervalMs, refreshing, fetchedAt, paused])

  // version web, retour sur l'onglet : actualisation si la dernière lecture date de plus d'une période
  useEffect(() => {
    if (paused || !isWeb || !intervalMs || refreshing) return
    if (Date.now() - Date.parse(fetchedAt) > intervalMs)
      startRefresh(() => refreshPrs())
  }, [paused]) // seulement au changement de visibilité

  useEffect(() => {
    if (!settings.refreshOnFocus || refreshing) return
    const onFocus = () => {
      // pas plus souvent que l'actualisation automatique (5 min en mode manuel)
      const min = intervalMs || 5 * 60_000
      if (Date.now() - Date.parse(fetchedAt) > min)
        startRefresh(() => refreshPrs())
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [settings.refreshOnFocus, refreshing, intervalMs, fetchedAt])

  // mise à jour : vérifiée au lancement puis toutes les 6 h (bandeau + badge sur l'engrenage)
  useEffect(() => {
    checkForUpdate({ quiet: true })
    const id = setInterval(() => checkForUpdate({ quiet: true }), 6 * 3_600_000)
    return () => clearInterval(id)
  }, [])

  // ⌘, (Ctrl+, ailleurs) : réglages, comme dans les apps macOS
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggle("settings")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // version web (globe : démarrée si besoin puis ouverte ; bulle : démarrée / arrêtée) ;
  // erreur de démarrage affichée sous l'en-tête
  const runWeb = async (action: () => Promise<WebStatus>) => {
    setWebBusy(true)
    setWebError(null)
    try {
      const status = await action()
      if (!status.running) setWebError(startErrorText(webErrors, status))
    } catch (e) {
      setWebError(e instanceof Error ? e.message : String(e))
    } finally {
      setWebBusy(false)
    }
  }

  const cmp = SORTS.find((s) => s.id === sort)?.cmp
  const nodes = useMemo(
    () => trees.flatMap((t) => t.roots.flatMap(descendants)),
    [trees],
  )

  const q = query.trim().toLowerCase()
  // staleDays : lu par le filtre « Inactives » (Date.now() relu à chaque nouvel arbre)
  const { staleDays } = settings
  const visible = useMemo(() => {
    const status = FILTERS.find((f) => f.id === filter)!.match
    const sorted = (roots: RepoTree["roots"]) =>
      cmp ? sortTree(roots, cmp) : roots
    return trees
      .map((t) => {
        const repoMatches = t.repo.toLowerCase().includes(q)
        const match = (p: PrNode) =>
          status(p) &&
          (!q ||
            repoMatches ||
            [p.title, p.head, `#${p.number}`].some((s) =>
              s.toLowerCase().includes(q),
            ))
        const merged =
          filter !== "all"
            ? []
            : t.merged.filter(
                (p) =>
                  !q ||
                  repoMatches ||
                  [p.title, `#${p.number}`].some((s) =>
                    s.toLowerCase().includes(q),
                  ),
              )
        return {
          tree: { ...t, roots: sorted(filterTree(t.roots, match)), merged },
          total: prs.filter((p) => p.repo === t.repo).length,
          repoMatches,
        }
      })
      .filter(
        (v) =>
          v.tree.roots.length ||
          v.tree.merged.length ||
          (filter === "all" && (!q || v.repoMatches)),
      )
  }, [trees, prs, q, filter, cmp, staleDays])

  const setAll = (v: boolean) =>
    setOpen(
      Object.fromEntries(
        [
          ...trees.map((t) => t.repo),
          ...prs.map((p) => `${p.repo}#${p.number}`),
        ].map((k) => [k, v]),
      ),
    )

  const counts = useMemo(
    () => FILTERS.map((f) => nodes.filter(f.match).length),
    [nodes, staleDays],
  )

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {!wide && (
            <Sheet open={reposOpen} onOpenChange={setReposOpen}>
              <SheetTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t.trackedRepos}
                    title={t.trackedRepos}
                  />
                }
              >
                <PanelLeft />
              </SheetTrigger>
              <SheetContent side="left" className="p-4 pt-12">
                <SheetTitle className="sr-only">{t.trackedRepos}</SheetTitle>
                <RepoSidebar
                  current={trees.map((t) => t.repo)}
                  withPrs={withPrs}
                  className="min-h-0 flex-1"
                />
              </SheetContent>
            </Sheet>
          )}
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {t.myOpenPrs}
            </h1>
            <p className="text-sm text-muted-foreground">
              {plural(trees.length, t.repo)} · {plural(prs.length, "PR")} ·{" "}
              {t.updatedAt(
                new Date(fetchedAt).toLocaleTimeString(locale(), {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              )}
              ,{" "}
              {settings.refreshMinutes === "auto"
                ? t.autoMode(Math.round(autoMs / 60_000))
                : settings.refreshMinutes
                  ? t.auto(settings.refreshMinutes)
                  : t.manual}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={() => startRefresh(() => refreshPrs())}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            {refreshing ? t.refreshing : t.refresh}
          </Button>
          {mcp.info?.supported && (
            <Button
              variant={page === "mcp" ? "secondary" : "ghost"}
              size="icon"
              aria-label={mcp.running ? t.mcpOn : t.mcp}
              title={mcp.running ? t.mcpOn : t.mcp}
              aria-pressed={page === "mcp"}
              onClick={() => toggle("mcp")}
              className="relative"
            >
              <Plug />
              {mcp.running && <RunningDot />}
            </Button>
          )}
          {!isWeb && (
            <WebMenu
              label={t.tray.web}
              busy={webBusy}
              onOpen={() => void runWeb(openWeb)}
              onToggle={() => void runWeb(toggleWeb)}
              onSettings={() => setPage("web")}
            />
          )}
          <Button
            variant={page === "settings" ? "secondary" : "ghost"}
            size="icon"
            aria-label={update ? t.settingsUpdate(update) : t.settings}
            title={update ? t.settingsTitleUpdate(update) : t.settingsTitle}
            aria-pressed={page === "settings"}
            onClick={() => toggle("settings")}
            className="relative"
          >
            <SettingsIcon />
            {update && (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-background" />
            )}
          </Button>
        </div>
      </header>

      <UpdateBanner />

      {webError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm duration-300 animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none"
        >
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">{webError}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setWebError(null)
              setPage("web")
            }}
          >
            {t.webSettings}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t.dismiss}
            title={t.dismiss}
            onClick={() => setWebError(null)}
          >
            <X />
          </Button>
        </div>
      )}

      {page === "settings" ? (
        <Suspense fallback={null}>
          <SettingsPage
            onClose={() => setPage(null)}
            onOpenWeb={() => setPage("web")}
          />
        </Suspense>
      ) : page === "mcp" ? (
        <Suspense fallback={null}>
          <McpPage onClose={() => setPage(null)} />
        </Suspense>
      ) : page === "web" ? (
        <Suspense fallback={null}>
          <WebPage onClose={() => setPage(null)} />
        </Suspense>
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6 lg:order-last">
            <nav
              ref={tabBox}
              role="tablist"
              aria-label={t.view}
              className="relative flex gap-1 border-b"
            >
              {underline && (
                <span
                  aria-hidden
                  style={{ left: underline.left, width: underline.width }}
                  className="absolute -bottom-px h-0.5 bg-primary transition-[left,width] duration-200 ease-out motion-reduce:transition-none"
                />
              )}
              {TABS.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === tb.id}
                  onClick={() => setTab(tb.id)}
                  className={cn(
                    "-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium transition-colors",
                    tab === tb.id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <tb.icon className="size-4" />
                  {t.tabs[tb.id]}
                  {tb.id === "review" && toReview > 0 && (
                    <Badge title={t.reviewCount(toReview)}>{toReview}</Badge>
                  )}
                </button>
              ))}
            </nav>

            {tab !== "calendar" && error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t.fetchFailed(error)}
              </p>
            )}
            {tab === "calendar" ? (
              <MergeCalendar />
            ) : tab === "review" ? (
              <ReviewList reviews={reviews.reviews} />
            ) : (
              <>
                <section className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="relative w-full max-w-sm">
                      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="search"
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t.searchPlaceholder}
                        aria-label={t.search}
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div
                      className="flex flex-wrap gap-1"
                      role="group"
                      aria-label={t.filterByStatus}
                    >
                      {FILTERS.map((f, i) => (
                        <Button
                          key={f.id}
                          size="xs"
                          variant={filter === f.id ? "default" : "outline"}
                          aria-pressed={filter === f.id}
                          onClick={() => setFilter(f.id)}
                        >
                          {t.filters[f.id]}
                          <Badge
                            variant={filter === f.id ? "secondary" : "outline"}
                          >
                            {counts[i]}
                          </Badge>
                        </Button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <label
                        htmlFor="sort"
                        className="text-sm text-muted-foreground"
                      >
                        {t.sort}
                      </label>
                      <select
                        id="sort"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                        className="h-8 rounded-lg border bg-background px-2 text-sm"
                      >
                        {SORTS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {t.sorts[s.id]}
                          </option>
                        ))}
                      </select>
                      {seen.count > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => seen.markSeen(prs)}
                        >
                          <CheckCheck />
                          {t.markAllSeen(seen.count)}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAll(true)}
                      >
                        {t.expandAll}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAll(false)}
                      >
                        {t.collapseAll}
                      </Button>
                    </div>
                  </div>
                </section>

                {trees.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t.noRepos}</p>
                )}
                {trees.length > 0 && visible.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t.noMatch}</p>
                )}
                {visible.map((v) => (
                  <RepoSection
                    key={v.tree.repo}
                    tree={v.tree}
                    total={v.total}
                    state={state}
                  />
                ))}
              </>
            )}
            <footer className="flex flex-wrap gap-x-4 gap-y-1 pt-4 text-xs text-muted-foreground">
              {shortcuts.map((s) => (
                <span key={s.keys}>
                  <kbd className="rounded border bg-muted px-1 font-mono">
                    {s.keys}
                  </kbd>{" "}
                  {s.label}
                </span>
              ))}
            </footer>
          </div>
          {wide && (
            <RepoSidebar current={trees.map((t) => t.repo)} withPrs={withPrs} />
          )}
        </div>
      )}
    </main>
  )
}

// même seuil que `lg:` : en dessous, le panneau des repos passe dans un tiroir
const WIDE = "(min-width: 64rem)"
function useWide() {
  return useSyncExternalStore(
    (l) => {
      const m = matchMedia(WIDE)
      m.addEventListener("change", l)
      return () => m.removeEventListener("change", l)
    },
    () => matchMedia(WIDE).matches,
  )
}

/** Onglet (ou fenêtre) caché. */
function useHidden() {
  return useSyncExternalStore(
    (l) => {
      document.addEventListener("visibilitychange", l)
      return () => document.removeEventListener("visibilitychange", l)
    },
    () => document.visibilityState === "hidden",
  )
}
