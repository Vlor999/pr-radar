import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
  ArrowDownUp,
  CalendarDays,
  Eye,
  Filter,
  GitPullRequest,
  Monitor,
  Moon,
  PanelLeft,
  Plug,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Shortcut, type ShortcutKeys } from "@/components/shortcut"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { setTheme, useTheme, type ThemeMode } from "@/hooks/use-theme"
import { strings, useStrings } from "@/lib/i18n"
import { openExternal } from "@/lib/open"
import type { Pr, ReviewPr } from "@/lib/types"

const S = strings(
  {
    title: "Palette de commandes",
    placeholder: "PR, onglet, filtre, commande…",
    empty: "Aucun résultat.",
    groups: {
      open: "PR ouvertes",
      review: "À reviewer",
      tabs: "Onglets",
      filters: "Filtres",
      sorts: "Tri",
      actions: "Actions",
      theme: "Thème",
    },
    goTo: (tab: string) => `Aller à : ${tab}`,
    filter: (f: string) => `Filtre : ${f}`,
    sort: (s: string) => `Tri : ${s}`,
    refresh: "Rafraîchir",
    settings: "Ouvrir les réglages",
    mcp: "Ouvrir le serveur MCP",
    repos: "Repos suivis",
    theme: { light: "Clair", dark: "Sombre", system: "Auto (système)" },
    themeLabel: (t: string) => `Thème : ${t}`,
    hintOpen: "ouvrir sur GitHub",
    hintReveal: "afficher dans la liste",
    hintClose: "fermer",
  },
  {
    title: "Command palette",
    placeholder: "PR, tab, filter, command…",
    empty: "No results.",
    groups: {
      open: "Open PRs",
      review: "To review",
      tabs: "Tabs",
      filters: "Filters",
      sorts: "Sort",
      actions: "Actions",
      theme: "Theme",
    },
    goTo: (tab: string) => `Go to: ${tab}`,
    filter: (f: string) => `Filter: ${f}`,
    sort: (s: string) => `Sort: ${s}`,
    refresh: "Refresh",
    settings: "Open settings",
    mcp: "Open MCP server",
    repos: "Tracked repos",
    theme: { light: "Light", dark: "Dark", system: "Auto (system)" },
    themeLabel: (t: string) => `Theme: ${t}`,
    hintOpen: "open on GitHub",
    hintReveal: "show in the list",
    hintClose: "close",
  },
)

const THEMES: { id: ThemeMode; icon: ReactNode }[] = [
  { id: "light", icon: <Sun /> },
  { id: "dark", icon: <Moon /> },
  { id: "system", icon: <Monitor /> },
]

const TAB_ICONS = {
  open: <GitPullRequest />,
  review: <Eye />,
  calendar: <CalendarDays />,
}

export type PaletteTab = keyof typeof TAB_ICONS
type Option<T extends string = string> = { id: T; label: string }

/** PR choisie : onglet où elle s'affiche (son arbre ou la liste « À reviewer »). */
type Target = { tab: "open"; pr: Pr } | { tab: "review"; pr: ReviewPr }

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

const findCard = (url: string) =>
  document.querySelector<HTMLElement>(
    `[data-pr-card][data-url="${CSS.escape(url)}"]`,
  )

/**
 * ⌘K (Ctrl+K ailleurs) : recherche floue (cmdk) sur les PR chargées et les commandes du tableau de bord.
 * Entrée ouvre la PR sur GitHub, ⌘/Ctrl+Entrée l'affiche dépliée dans sa liste.
 */
export function CommandPalette({
  prs,
  reviews,
  tabs,
  filters,
  sorts,
  current,
  mcp,
  on,
}: {
  prs: Pr[]
  reviews: ReviewPr[]
  tabs: Option<PaletteTab>[]
  filters: Option[]
  sorts: Option[]
  current: { tab: PaletteTab; filter: string; sort: string }
  /** serveur MCP disponible sur cette plateforme */
  mcp: boolean
  on: {
    tab: (id: PaletteTab) => void
    filter: (id: string) => void
    sort: (id: string) => void
    refresh: () => void
    settings: () => void
    mcp: () => void
    repos: () => void
    /** déplie la PR (et son repo) dans l'arbre des PR ouvertes */
    expand: (pr: Pr) => void
    /** retire recherche et filtre de statut : la PR cachée redevient visible */
    showAll: () => void
  }
}) {
  const t = useStrings(S)
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState("")
  // PR à afficher une fois la palette fermée (le focus revient alors sur sa carte, pas au déclencheur)
  const pending = useRef<Target | null>(null)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return
      if (e.altKey || e.shiftKey) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // colonne des numéros : largeur du plus long (« # » compris), pour aligner les titres
  const numberWidth =
    Math.max(0, ...[...prs, ...reviews].map((p) => String(p.number).length)) + 1

  const targets = new Map<string, Target>([
    ...prs.map((pr) => [pr.url, { tab: "open", pr }] as const),
    ...reviews.map((pr) => [pr.url, { tab: "review", pr }] as const),
  ])

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  const reveal = (target: Target) => {
    pending.current = target
    setOpen(false)
  }

  // après la fermeture (animation finie) : onglet, dépliage, puis focus sur la carte
  const afterClose = async () => {
    const target = pending.current
    pending.current = null
    if (!target) return
    if (target.tab === "open") on.expand(target.pr)
    else on.tab("review")
    await frame()
    let card = findCard(target.pr.url)
    if (!card && target.tab === "open") {
      on.showAll()
      await frame()
      card = findCard(target.pr.url)
    }
    card?.focus({ preventScroll: true })
    card?.scrollIntoView({ block: "center" })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return
    const target = targets.get(selected)
    if (!target) return // commande : ⌘Entrée = Entrée
    e.preventDefault()
    reveal(target)
  }

  const prItem = (pr: Pr | ReviewPr) => (
    <CommandItem
      key={pr.url}
      value={pr.url}
      keywords={[
        pr.title,
        pr.repo,
        `#${pr.number}`,
        "head" in pr ? pr.head : pr.author,
      ]}
      onSelect={() => run(() => openExternal(pr.url))}
    >
      <span className="w-(--pr-number-w) shrink-0 text-right text-muted-foreground tabular-nums">
        #{pr.number}
      </span>
      <span className="min-w-0 flex-1 truncate">{pr.title}</span>
      <span className="shrink-0 truncate text-xs font-normal text-muted-foreground">
        {pr.repo}
      </span>
    </CommandItem>
  )

  const commandItem = (
    label: string,
    icon: ReactNode,
    action: () => void,
    opts: { checked?: boolean; shortcut?: ShortcutKeys } = {},
  ) => (
    <CommandItem
      key={label}
      value={label}
      data-checked={opts.checked}
      onSelect={() => run(action)}
    >
      {icon}
      {label}
      {opts.shortcut && (
        // ligne sélectionnée (fond muted) : cabochons sur le fond de page pour rester visibles
        <CommandShortcut className="tracking-normal group-data-selected/command-item:**:data-[slot=kbd]:bg-background">
          <Shortcut keys={opts.shortcut} />
        </CommandShortcut>
      )}
    </CommandItem>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(v) => {
        if (!v) void afterClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={() => pending.current === null}
        className="top-1/4 translate-y-0 overflow-hidden rounded-(--palette-radius)! p-0 [--palette-radius:1.625rem] sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{t.title}</DialogTitle>
        <Command
          vimBindings={false}
          className="rounded-(--palette-radius)"
          value={selected}
          onValueChange={setSelected}
          onKeyDown={onKeyDown}
        >
          <CommandInput placeholder={t.placeholder} />
          <CommandList
            className="max-h-96"
            style={{ "--pr-number-w": `${numberWidth}ch` } as CSSProperties}
          >
            <CommandEmpty>{t.empty}</CommandEmpty>
            {prs.length > 0 && (
              <CommandGroup heading={t.groups.open}>
                {prs.map(prItem)}
              </CommandGroup>
            )}
            {reviews.length > 0 && (
              <CommandGroup heading={t.groups.review}>
                {reviews.map(prItem)}
              </CommandGroup>
            )}
            <CommandGroup heading={t.groups.tabs}>
              {tabs.map((tb) =>
                commandItem(
                  t.goTo(tb.label),
                  TAB_ICONS[tb.id],
                  () => on.tab(tb.id),
                  {
                    checked: current.tab === tb.id,
                  },
                ),
              )}
            </CommandGroup>
            <CommandGroup heading={t.groups.filters}>
              {filters.map((f) =>
                commandItem(
                  t.filter(f.label),
                  <Filter />,
                  () => on.filter(f.id),
                  {
                    checked: current.filter === f.id,
                  },
                ),
              )}
            </CommandGroup>
            <CommandGroup heading={t.groups.sorts}>
              {sorts.map((s) =>
                commandItem(
                  t.sort(s.label),
                  <ArrowDownUp />,
                  () => on.sort(s.id),
                  {
                    checked: current.sort === s.id,
                  },
                ),
              )}
            </CommandGroup>
            <CommandGroup heading={t.groups.actions}>
              {commandItem(t.refresh, <RefreshCw />, on.refresh)}
              {commandItem(t.settings, <SettingsIcon />, on.settings, {
                shortcut: ["mod", ","],
              })}
              {mcp && commandItem(t.mcp, <Plug />, on.mcp)}
              {commandItem(t.repos, <PanelLeft />, on.repos)}
            </CommandGroup>
            <CommandGroup heading={t.groups.theme}>
              {THEMES.map((th) =>
                commandItem(
                  t.themeLabel(t.theme[th.id]),
                  th.icon,
                  () => setTheme(th.id),
                  { checked: theme === th.id },
                ),
              )}
            </CommandGroup>
          </CommandList>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
            <Hint keys={["enter"]} label={t.hintOpen} />
            <Hint keys={["mod", "enter"]} label={t.hintReveal} />
            <Hint keys={["esc"]} label={t.hintClose} />
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function Hint({ keys, label }: { keys: ShortcutKeys; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Shortcut keys={keys} />
      {label}
    </span>
  )
}
