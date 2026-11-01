import { cn } from "cn"
import {
  ArrowLeft,
  Bell,
  GitPullRequest,
  Globe,
  Plug,
  Search,
  Settings2,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"

import {
  AccountsCategory,
  accountsEntries,
} from "@/components/settings/accounts"
import {
  AdvancedCategory,
  advancedEntries,
} from "@/components/settings/advanced"
import {
  CATEGORIES,
  type CategoryProps,
  type SettingsCategory,
  type SettingsEntry,
} from "@/components/settings/category"
import { GeneralCategory, generalEntries } from "@/components/settings/general"
import { McpCategory, mcpEntries } from "@/components/settings/mcp"
import {
  NotificationsCategory,
  notificationsEntries,
} from "@/components/settings/notifications"
import { PrsCategory, prsEntries } from "@/components/settings/prs"
import { settingDomId } from "@/components/settings/ui"
import { WebCategory, webEntries } from "@/components/settings/web"
import { Shortcut } from "@/components/shortcut"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SETTING_HIGHLIGHT_MS } from "@/lib/constants"
import { currentLang, strings, useStrings, type Lang } from "@/lib/i18n"
import { useMcp } from "@/lib/mcp"
import { reducedMotion } from "@/lib/motion"
import { isWeb } from "@/lib/platform"
import { useSettings } from "@/lib/settings"
import { flatResults, searchSettings } from "@/lib/settings-search"

export type { SettingsCategory }

type Category = SettingsCategory
type Entry = SettingsEntry

/**
 * Une entrée par catégorie (ordre : CATEGORIES) : icône du menu, contenu, lignes indexées par la recherche.
 * Nouvelle catégorie : son id dans CATEGORIES, son libellé dans `S.categories`, un fichier dans settings/.
 */
const CATEGORY_VIEWS: Record<
  Category,
  {
    icon: LucideIcon
    Content: ComponentType<CategoryProps>
    entries: (lang: Lang) => Entry[]
  }
> = {
  general: {
    icon: Settings2,
    Content: GeneralCategory,
    entries: generalEntries,
  },
  accounts: {
    icon: Users,
    Content: AccountsCategory,
    entries: accountsEntries,
  },
  notifications: {
    icon: Bell,
    Content: NotificationsCategory,
    entries: notificationsEntries,
  },
  prs: { icon: GitPullRequest, Content: PrsCategory, entries: prsEntries },
  mcp: { icon: Plug, Content: McpCategory, entries: mcpEntries },
  web: { icon: Globe, Content: WebCategory, entries: webEntries },
  advanced: {
    icon: SlidersHorizontal,
    Content: AdvancedCategory,
    entries: advancedEntries,
  },
}

const S = strings(
  {
    categories: {
      general: "Général",
      accounts: "Comptes",
      notifications: "Notifications",
      prs: "PR et repos",
      mcp: "Serveur MCP",
      web: "Version web",
      advanced: "Avancé",
    },
    search: {
      placeholder: "Rechercher un réglage",
      count: (n: number) => `${n} résultat${n > 1 ? "s" : ""}`,
      others: "Autres catégories",
      empty: "Aucun réglage trouvé",
    },
    nav: "Catégories des réglages",
    back: "Retour",
  },
  {
    categories: {
      general: "General",
      accounts: "Accounts",
      notifications: "Notifications",
      prs: "PRs and repos",
      mcp: "MCP server",
      web: "Web version",
      advanced: "Advanced",
    },
    search: {
      placeholder: "Search settings",
      count: (n: number) => `${n} result${n > 1 ? "s" : ""}`,
      others: "Other categories",
      empty: "No setting found",
    },
    nav: "Settings categories",
    back: "Back",
  },
)

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.matches("input, textarea, select") || t.isContentEditable)

/* ---------- Recherche ---------- */

function SearchResults(props: {
  results: ReturnType<typeof searchSettings<Category>>
  selected: string | undefined
  onSelect: (e: Entry) => void
  onHover: (id: string) => void
}) {
  const t = useStrings(S)
  const { results } = props
  const option = (e: Entry, withCategory: boolean) => (
    <li
      key={e.id}
      id={`settings-result-${e.id}`}
      role="option"
      aria-selected={props.selected === e.id}
      onClick={() => props.onSelect(e)}
      onMouseMove={() => props.onHover(e.id)}
      className={cn(
        "cursor-pointer border-t px-4 py-2.5 first:border-t-0",
        props.selected === e.id && "bg-muted",
      )}
    >
      <div className="text-sm font-medium">
        {e.label}
        {withCategory && e.group && (
          <span className="font-normal text-muted-foreground">
            {" · "}
            {e.group}
          </span>
        )}
      </div>
      {e.description && (
        <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {e.description}
        </div>
      )}
    </li>
  )
  if (!results.count)
    return (
      <p
        aria-live="polite"
        className="py-8 text-center text-sm text-muted-foreground"
      >
        {t.search.empty}
      </p>
    )
  // listbox : seulement des groupes d'options ; compte annoncé à côté, intitulés visuels
  // aria-hidden et repris comme noms des groupes (aria-labelledby)
  return (
    <div className="flex flex-col gap-6">
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {t.search.count(results.count)}
      </p>
      <div
        id="settings-results"
        role="listbox"
        aria-label={t.search.count(results.count)}
        className="flex flex-col gap-6"
      >
        {results.current.length > 0 && (
          <div
            role="group"
            aria-label={t.categories[results.current[0].category]}
          >
            <ul
              role="presentation"
              className="overflow-hidden rounded-2xl border bg-card"
            >
              {results.current.map((e) => option(e, true))}
            </ul>
          </div>
        )}
        {results.others.length > 0 && (
          <div role="presentation" className="flex flex-col gap-3">
            <div
              id="settings-results-others"
              aria-hidden
              className="text-sm font-semibold text-muted-foreground"
            >
              {t.search.others}
            </div>
            {results.others.map((g) => (
              <div
                key={g.category}
                role="group"
                aria-labelledby={`settings-results-others settings-results-${g.category}`}
              >
                <div
                  id={`settings-results-${g.category}`}
                  aria-hidden
                  className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  {t.categories[g.category]}
                </div>
                <ul
                  role="presentation"
                  className="overflow-hidden rounded-2xl border bg-card"
                >
                  {g.entries.map((e) => option(e, true))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Page ---------- */

/**
 * Réglages plein écran. La catégorie affichée est tenue par le tableau de bord (pr-dashboard.tsx),
 * qui les ouvre directement sur « Serveur MCP » ou « Version web » depuis ses boutons et la palette.
 */
export function SettingsPage({
  category: requested,
  onCategory,
  onClose,
}: {
  category: Category
  onCategory: (c: Category) => void
  onClose: () => void
}) {
  const t = useStrings(S)
  const lang = currentLang(useSettings().lang)
  // mêmes conditions que les anciens points d'entrée : bouton MCP si le binaire le gère, version web dans l'app seulement
  const mcpInfo = useMcp().info
  const mcpSupported = !!mcpInfo?.supported
  const available = (c: Category) =>
    c === "mcp" ? mcpSupported : c === "web" ? !isWeb : true
  const category = available(requested) ? requested : "general"
  // catégorie indisponible pour de bon : le tableau de bord se recale sur Général. Infos MCP encore
  // en chargement (info null au lancement) : on garde « mcp » demandé, affiché dès qu'il est confirmé.
  const settled = requested !== "mcp" || mcpInfo !== null
  useEffect(() => {
    if (category !== requested && settled) onCategory(category)
  }, [category, requested, settled, onCategory])
  const [troubleshootOpen, setTroubleshootOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  /** réglage à montrer après le rendu de sa catégorie */
  const target = useRef<string | null>(null)
  const highlightTimer = useRef<number>(undefined)
  /** élément surligné en ce moment */
  const highlighted = useRef<HTMLElement | null>(null)
  const clearHighlight = () => {
    clearTimeout(highlightTimer.current)
    if (highlighted.current) delete highlighted.current.dataset.highlight
    highlighted.current = null
  }

  // index statique des réglages dans la langue affichée, catégorie par catégorie
  const index = useMemo(
    () =>
      CATEGORIES.filter(available)
        .flatMap((c) => CATEGORY_VIEWS[c].entries(lang))
        .filter((e) => !(isWeb && e.desktopOnly)),
    // available ne dépend que de mcpSupported
    [lang, mcpSupported],
  )
  const results = useMemo(
    () => searchSettings(index, query, category),
    [index, query, category],
  )
  const flat = flatResults(results)
  const searching = query.trim() !== ""
  const selected = flat[Math.min(cursor, flat.length - 1)]?.id

  useEffect(() => {
    const focusSearch = () => {
      search.current?.focus()
      search.current?.select()
    }
    const onKey = (e: KeyboardEvent) => {
      // palette de commandes ouverte : ses touches restent les siennes
      if (
        (e.target as HTMLElement | null)?.closest?.(
          "[data-slot=dialog-content]",
        )
      )
        return
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault()
        focusSearch()
        return
      }
      if (isTyping(e.target) || e.defaultPrevented) return
      if (e.key === "Escape") onClose()
      else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        focusSearch()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => () => clearTimeout(highlightTimer.current), [])

  // nouvelle catégorie (menu, bouton MCP, palette) : en haut de page ; le réglage cherché défile ensuite
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [category])

  // réglage choisi dans la recherche : défilement, focus sur sa commande, surlignage bref
  useEffect(() => {
    const id = target.current
    if (!id) return
    target.current = null
    const el = document.getElementById(settingDomId(id))
    if (!el) return
    el.scrollIntoView({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "center",
    })
    // focus sur la ligne elle-même (sans anneau, outline-none) : Tab mène ensuite à sa commande,
    // sans l'anneau focus-visible qu'un focus programmé sur le bouton affiche après Entrée
    el.tabIndex = -1
    el.focus({ preventScroll: true })
    // résultat précédent encore surligné (deux résultats à moins de SETTING_HIGHLIGHT_MS) : éteint d'abord
    clearHighlight()
    el.dataset.highlight = ""
    highlighted.current = el
    highlightTimer.current = window.setTimeout(
      clearHighlight,
      SETTING_HIGHLIGHT_MS,
    )
  })

  useEffect(() => {
    if (selected)
      document
        .getElementById(`settings-result-${selected}`)
        ?.scrollIntoView({ block: "nearest" })
  }, [selected])

  const open = (e: Entry) => {
    target.current = e.id
    // seul groupe repliable : « Dépannage » (notifications)
    if (e.group) setTroubleshootOpen(true)
    setQuery("")
    setCursor(0)
    onCategory(e.category)
  }

  const go = (c: Category) => {
    setQuery("")
    onCategory(c)
  }

  const Content = CATEGORY_VIEWS[category].Content

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!flat.length) return
      e.preventDefault()
      const i = Math.min(cursor, flat.length - 1)
      setCursor(
        e.key === "ArrowDown"
          ? Math.min(i + 1, flat.length - 1)
          : Math.max(i - 1, 0),
      )
    } else if (e.key === "Enter") {
      const hit = flat.find((r) => r.id === selected)
      if (hit) {
        e.preventDefault()
        open(hit)
      }
    } else if (e.key === "Escape") {
      // 1er Échap : vide la recherche ; 2e : quitte le champ (la page reste ouverte)
      if (query) setQuery("")
      else e.currentTarget.blur()
      setCursor(0)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-8 md:px-6">
      <nav
        aria-label={t.nav}
        className="shrink-0 md:sticky md:top-4 md:w-48 md:self-start"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="mb-2 -ml-2"
        >
          <ArrowLeft data-icon="inline-start" />
          {t.back}
        </Button>
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 py-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:py-0">
          {CATEGORIES.filter(available).map((c) => {
            const Icon = CATEGORY_VIEWS[c].icon
            return (
              <li key={c} className="shrink-0">
                {/* Avancé à part : réglages rarement touchés et zone sensible */}
                {c === "advanced" && (
                  <div
                    role="separator"
                    className="mx-3 my-2 hidden border-t md:block"
                  />
                )}
                <button
                  type="button"
                  onClick={() => go(c)}
                  aria-current={category === c ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none",
                    category === c
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {t.categories[c]}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="flex w-full max-w-2xl min-w-0 flex-col gap-8 pb-16">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={search}
            id="settings-search"
            type="search"
            role="combobox"
            aria-expanded={searching && results.count > 0}
            aria-controls={
              searching && results.count > 0 ? "settings-results" : undefined
            }
            aria-activedescendant={
              searching && selected ? `settings-result-${selected}` : undefined
            }
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onSearchKey}
            placeholder={t.search.placeholder}
            aria-label={t.search.placeholder}
            className="pr-16 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          <Shortcut
            keys={["/"]}
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2"
          />
        </div>
        {searching ? (
          <SearchResults
            results={results}
            selected={selected}
            onSelect={open}
            onHover={(id) => setCursor(flat.findIndex((r) => r.id === id))}
          />
        ) : (
          <>
            <h1 className="-mb-4 text-xl font-semibold">
              {t.categories[category]}
            </h1>
            <Content
              troubleshootOpen={troubleshootOpen}
              onTroubleshootOpen={setTroubleshootOpen}
            />
          </>
        )}
      </div>
    </div>
  )
}
