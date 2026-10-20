import { useEffect, useState, useSyncExternalStore, useTransition } from "react"
import {
  CalendarDays,
  CheckCheck,
  GitPullRequest,
  PanelLeft,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
} from "lucide-react"
import { cn } from "cn"

import { refreshPrs } from "@/lib/actions"
import { reload } from "@/lib/store"
import { MergeCalendar } from "@/components/merge-calendar"
import { plural } from "@/components/pr-card"
import { RepoSidebar } from "@/components/repo-sidebar"
import { SettingsPage } from "@/components/settings-page"
import { UpdateBanner } from "@/components/update-banner"
import { checkForUpdate, useUpdate } from "@/lib/updater"
import { getSettings, useSettings } from "@/lib/settings"
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
import { usePrNotifications } from "@/hooks/use-pr-notifications"
import { useSeen } from "@/hooks/use-seen"
import {
  descendants,
  filterTree,
  isStacked,
  isStale,
  mergeState,
  needsAttention,
  sortTree,
} from "@/lib/tree"
import type { Pr, PrNode, RepoTree } from "@/lib/types"

const TABS = [
  { id: "open", label: "PR ouvertes", icon: GitPullRequest },
  { id: "calendar", label: "Calendrier des merges", icon: CalendarDays },
] as const

const FILTERS: { id: string; label: string; match: (p: PrNode) => boolean }[] =
  [
    { id: "all", label: "Toutes", match: () => true },
    { id: "attention", label: "À traiter", match: needsAttention },
    {
      id: "ready",
      label: "Prêtes à merger",
      match: (p) => mergeState(p)?.kind === "ready",
    },
    {
      id: "approved",
      label: "Approuvées",
      match: (p) => p.decision === "APPROVED",
    },
    { id: "stacked", label: "Stackées", match: isStacked },
    { id: "draft", label: "Draft", match: (p) => p.draft },
    {
      id: "ci",
      label: "CI rouge",
      match: (p) => p.ci === "FAILURE" || p.ci === "ERROR",
    },
    {
      id: "stale",
      label: "Inactives",
      match: (p) => isStale(p, Date.now(), getSettings().staleDays),
    },
  ]

const SORTS: { id: string; label: string; cmp?: (a: Pr, b: Pr) => number }[] = [
  { id: "priority", label: "Priorité" }, // ordre déjà calculé par buildTree
  {
    id: "oldest",
    label: "Plus anciennes",
    cmp: (a, b) => Date.parse(a.updated) - Date.parse(b.updated),
  },
  {
    id: "recent",
    label: "Plus récentes",
    cmp: (a, b) => Date.parse(b.updated) - Date.parse(a.updated),
  },
]

export function PrDashboard({
  prs,
  trees,
  withPrs,
  fetchedAt,
  error,
}: {
  prs: Pr[]
  trees: RepoTree[]
  withPrs: string[]
  fetchedAt: string
  error?: string
}) {
  const wide = useWide()
  const [reposOpen, setReposOpen] = useState(false)
  const [refreshing, startRefresh] = useTransition()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const settings = useSettings()
  const [sort, setSort] = useState<string>(() => getSettings().defaultSort)
  const [showSettings, setShowSettings] = useState(false)
  const updateState = useUpdate()
  const update = updateState.status === "available" ? updateState.version : null
  const [tab, setTab] = useState<"open" | "calendar">("open")
  usePrNotifications(prs)
  const seen = useSeen(prs)
  useKeyboardNav()

  // l'état déplié/replié survit aux rafraîchissements (le composant n'est pas remonté)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const state: OpenState = {
    isOpen: (k, fallback) => open[k] ?? fallback,
    toggle: (k, v) => setOpen((o) => ({ ...o, [k]: v })),
    isNew: seen.isNew,
    markSeen: seen.markSeen,
  }

  // actualisation automatique (0 = manuelle) et au retour sur la fenêtre
  useEffect(() => {
    if (!settings.refreshMinutes) return
    const id = setInterval(
      () => startRefresh(() => reload()),
      settings.refreshMinutes * 60_000,
    )
    return () => clearInterval(id)
  }, [settings.refreshMinutes])

  useEffect(() => {
    if (!settings.refreshOnFocus) return
    const onFocus = () => {
      // pas plus souvent que l'actualisation automatique (5 min en mode manuel)
      const min = (settings.refreshMinutes || 5) * 60_000
      if (Date.now() - Date.parse(fetchedAt) > min) startRefresh(() => reload())
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [settings.refreshOnFocus, settings.refreshMinutes, fetchedAt])

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
        setShowSettings((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const cmp = SORTS.find((s) => s.id === sort)?.cmp
  const sorted = (roots: RepoTree["roots"]) =>
    cmp ? sortTree(roots, cmp) : roots
  const nodes = trees.flatMap((t) => t.roots.flatMap(descendants))

  const q = query.trim().toLowerCase()
  const status = FILTERS.find((f) => f.id === filter)!.match
  const visible = trees
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

  const setAll = (v: boolean) =>
    setOpen(
      Object.fromEntries(
        [
          ...trees.map((t) => t.repo),
          ...prs.map((p) => `${p.repo}#${p.number}`),
        ].map((k) => [k, v]),
      ),
    )

  const count = (match: (p: PrNode) => boolean) => nodes.filter(match).length

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
                    aria-label="Repos suivis"
                    title="Repos suivis"
                  />
                }
              >
                <PanelLeft />
              </SheetTrigger>
              <SheetContent side="left" className="p-4 pt-12">
                <SheetTitle className="sr-only">Repos suivis</SheetTitle>
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
              Mes PR ouvertes
            </h1>
            <p className="text-sm text-muted-foreground">
              {plural(trees.length, "repo")} · {plural(prs.length, "PR")} · mis
              à jour{" "}
              {new Date(fetchedAt).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              ,{" "}
              {settings.refreshMinutes
                ? `auto toutes les ${settings.refreshMinutes} min`
                : "actualisation manuelle"}
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
            {refreshing ? "Rafraîchissement…" : "Rafraîchir"}
          </Button>
          <Button
            variant={showSettings ? "secondary" : "ghost"}
            size="icon"
            aria-label={
              update ? `Réglages (version ${update} disponible)` : "Réglages"
            }
            title={
              update
                ? `Réglages · version ${update} disponible`
                : "Réglages (⌘,)"
            }
            aria-pressed={showSettings}
            onClick={() => setShowSettings((v) => !v)}
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

      {showSettings ? (
        <SettingsPage onClose={() => setShowSettings(false)} />
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6 lg:order-last">
            <nav
              role="tablist"
              aria-label="Vue"
              className="flex gap-1 border-b"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    tab === t.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <t.icon className="size-4" />
                  {t.label}
                </button>
              ))}
            </nav>

            {tab === "calendar" ? (
              <MergeCalendar />
            ) : (
              <>
                {error && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    Récupération GitHub en échec : {error}
                  </p>
                )}

                <section className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="relative w-full max-w-sm">
                      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="search"
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Repo, titre, branche, #numéro"
                        aria-label="Rechercher"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div
                      className="flex flex-wrap gap-1"
                      role="group"
                      aria-label="Filtrer par statut"
                    >
                      {FILTERS.map((f) => (
                        <Button
                          key={f.id}
                          size="xs"
                          variant={filter === f.id ? "default" : "outline"}
                          aria-pressed={filter === f.id}
                          onClick={() => setFilter(f.id)}
                        >
                          {f.label}
                          <Badge
                            variant={filter === f.id ? "secondary" : "outline"}
                          >
                            {count(f.match)}
                          </Badge>
                        </Button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <label
                        htmlFor="sort"
                        className="text-sm text-muted-foreground"
                      >
                        Tri
                      </label>
                      <select
                        id="sort"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                        className="h-8 rounded-lg border bg-background px-2 text-sm"
                      >
                        {SORTS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
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
                          Tout marquer comme vu ({seen.count})
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAll(true)}
                      >
                        Tout déplier
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAll(false)}
                      >
                        Tout replier
                      </Button>
                    </div>
                  </div>
                </section>

                {trees.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Aucun repo suivi. Coche des repos dans le panneau « Repos
                    suivis ».
                  </p>
                )}
                {trees.length > 0 && visible.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Aucune PR ne correspond à la recherche.
                  </p>
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
              {SHORTCUTS.map((s) => (
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
