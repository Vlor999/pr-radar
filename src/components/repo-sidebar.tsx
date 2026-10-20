import { useEffect, useOptimistic, useState, useTransition } from "react"
import { ChevronRight, Loader2, Plus, Search, X } from "lucide-react"
import { cn } from "cn"

import { accessibleRepos, addRepo, setFollowed } from "@/lib/actions"
import { CLIENT_ID } from "@/lib/auth"
import { updateSettings, useSettings } from "@/lib/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"

const ORG_ACCESS_URL = `https://github.com/settings/connections/applications/${CLIENT_ID}`

const lower = (s: string) => s.toLowerCase()

/** Panneau des repos accessibles, groupés par organisation, à cocher pour les suivre. */
const PrDot = ({ title }: { title: string }) => (
  <span
    role="img"
    aria-label={title}
    title={title}
    className="size-2 shrink-0 rounded-full bg-green-500"
  />
)

export function RepoSidebar({
  current,
  withPrs,
  className,
}: {
  current: string[]
  withPrs: string[]
  className?: string
}) {
  const hidden = new Set(useSettings().hiddenRepos.map(lower))
  const hasPr = new Set(withPrs.map(lower))
  const [followedAtMount] = useState(() => new Set(current.map(lower)))
  const [all, setAll] = useState<string[] | null>(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [openOrgs, setOpenOrgs] = useState<Record<string, boolean>>({})
  const [pending, start] = useTransition()
  // la case change tout de suite, le serveur suit
  const [followed, toggleOptimistic] = useOptimistic(
    new Set(current.map(lower)),
    (set, { repo, on }: { repo: string; on: boolean }) => {
      const next = new Set(set)
      if (on) next.add(lower(repo))
      else next.delete(lower(repo))
      return next
    },
  )

  useEffect(() => {
    accessibleRepos().then((res) => {
      setAll(res.repos)
      setError(res.error ?? "")
    })
  }, [])

  const toggle = (repo: string, on: boolean) =>
    start(async () => {
      toggleOptimistic({ repo, on })
      await setFollowed(repo, on)
    })

  // `owner/repo` masque un repo, `owner` toute l'organisation
  const hide = (name: string, repos: string[]) => {
    updateSettings({ hiddenRepos: [...hidden, lower(name)] })
    for (const r of repos) if (followed.has(lower(r))) toggle(r, false)
  }
  const isHidden = (r: string) =>
    hidden.has(lower(r)) || hidden.has(lower(r.split("/")[0]))

  const addTyped = () =>
    start(async () => {
      updateSettings({
        hiddenRepos: [...hidden].filter((r) => r !== lower(query.trim())),
      })
      const res = await addRepo(query)
      setError(res.error ?? "")
      if (!res.error) setQuery("")
    })

  // repos suivis hors de la liste accessible (ajoutés à la main) inclus aussi
  const repos = [...new Set([...(all ?? []), ...current])].filter(
    (r) => !isHidden(r),
  )
  const q = lower(query.trim())
  const byOrg = new Map<string, string[]>()
  for (const r of repos.filter((r) => lower(r).includes(q))) {
    const org = r.split("/")[0]
    byOrg.set(org, [...(byOrg.get(org) ?? []), r])
  }
  const count = (rs: string[]) =>
    rs.filter((r) => followed.has(lower(r))).length
  // ordre figé sur l'état à l'ouverture : masquer ou cocher ne fait pas bouger la liste.
  // orgs avec des repos suivis d'abord, puis par nombre de repos
  const rank = (org: string) => {
    const rs = [...(all ?? []), ...current].filter(
      (r) => r.split("/")[0] === org,
    )
    return [rs.filter((r) => followedAtMount.has(lower(r))).length, rs.length]
  }
  const orgs = [...byOrg].sort(([a], [b]) => {
    const [fa, na] = rank(a)
    const [fb, nb] = rank(b)
    return fb - fa || nb - na || a.localeCompare(b)
  })
  const canAddTyped =
    /^[\w.-]+\/[\w.-]+$/.test(query.trim()) &&
    !repos.some((r) => lower(r) === q)

  return (
    <aside
      className={cn(
        "flex flex-col gap-3 lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)]",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold">Repos suivis</h2>
        <span className="text-xs text-muted-foreground">
          {followed.size} / {repos.length || "…"}
        </span>
      </div>
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault()
          if (canAddTyped) addTyped()
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="repo-filter"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrer les repos"
          aria-label="Filtrer les repos"
          className="pl-9"
          autoComplete="off"
        />
      </form>
      {canAddTyped && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={addTyped}
        >
          <Plus />
          Suivre {query.trim()}
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1 pb-2">
        {all === null && (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Chargement des repos
            accessibles…
          </p>
        )}
        {all !== null && orgs.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">
            Aucun repo ne correspond
          </p>
        )}
        {orgs.map(([org, rs]) => (
          <Collapsible
            key={org}
            // repliées par défaut ; une recherche déplie tout
            open={q ? true : (openOrgs[org] ?? false)}
            onOpenChange={(v) => setOpenOrgs((o) => ({ ...o, [org]: v }))}
          >
            <div className="group/row relative">
              <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-sm font-medium hover:bg-muted">
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
                <span className="min-w-0 flex-1 truncate">{org}</span>
                {rs.some((r) => hasPr.has(lower(r))) && (
                  <PrDot title="PR ouverte dans cette organisation" />
                )}
                <Badge variant={count(rs) ? "secondary" : "outline"}>
                  {count(rs)} / {rs.length}
                </Badge>
                <span className="w-5 shrink-0" />
              </CollapsibleTrigger>
              <HideButton name={org} onClick={() => hide(org, rs)} />
            </div>
            <CollapsibleContent>
              <ul className="flex flex-col py-0.5 pl-5">
                {rs.map((r) => {
                  const id = `repo-${r}`
                  return (
                    <li key={r} className="group/row relative">
                      <label
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          id={id}
                          checked={followed.has(lower(r))}
                          onCheckedChange={(on) => toggle(r, on)}
                        />
                        <span className="min-w-0 truncate font-mono text-xs">
                          {r.slice(org.length + 1)}
                        </span>
                        {hasPr.has(lower(r)) && (
                          <PrDot title="J'ai une PR ouverte" />
                        )}
                        {/* place pour le bouton masquer */}
                        <span className="w-5 shrink-0" />
                      </label>
                      <HideButton name={r} onClick={() => hide(r, [r])} />
                    </li>
                  )
                })}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
      {hidden.size > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            {hidden.size} masqué{hidden.size > 1 ? "s" : ""}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col py-0.5 pl-5">
              {[...hidden].sort().map((h) => (
                <li
                  key={h}
                  className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-muted"
                >
                  <span className="min-w-0 truncate font-mono">{h}</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateSettings({
                        hiddenRepos: [...hidden].filter((x) => x !== h),
                      })
                    }
                    className="shrink-0 text-primary hover:underline"
                  >
                    Réafficher
                  </button>
                </li>
              ))}
              {hidden.size > 1 && (
                <li className="px-1 pt-1">
                  <button
                    type="button"
                    onClick={() => updateSettings({ hiddenRepos: [] })}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Tout réafficher
                  </button>
                </li>
              )}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
      <p className="border-t pt-3 text-xs text-muted-foreground">
        Une organisation manque ? Elle bloque peut-être les apps tierces :{" "}
        <a href={ORG_ACCESS_URL} className="text-primary hover:underline">
          demander l'accès pour PR Radar
        </a>{" "}
        (un admin de l'org valide), ou connecte-toi avec le CLI gh.
      </p>
    </aside>
  )
}

function HideButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Masquer ${name}`}
      title="Retirer de la liste"
      className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100"
    >
      <X className="size-3.5" />
    </button>
  )
}
