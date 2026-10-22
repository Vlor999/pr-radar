import { Loader2, Plus } from "lucide-react"
import { useEffect, useState } from "react"

import { Avatar } from "@/components/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { addReviewer } from "@/lib/actions"
import { fetchReviewerOptions } from "@/lib/github"
import { strings, useStrings } from "@/lib/i18n"
import { reviewerCandidates, type Reviewer } from "@/lib/reviewers"
import type { Pr } from "@/lib/types"

const SEARCH_DEBOUNCE_MS = 250 // une requête GraphQL par frappe sinon

const S = strings(
  {
    add: "Ajouter un reviewer",
    search: "Rechercher un utilisateur",
    none: "Aucun utilisateur",
  },
  {
    add: "Add a reviewer",
    search: "Search a user",
    none: "No user",
  },
)

/** Bouton « + » des reviewers : suggestions GitHub puis recherche parmi les utilisateurs assignables. */
export function AddReviewer({ pr }: { pr: Pr }) {
  const t = useStrings(S)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<{
    prId: string
    users: Reviewer[]
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    let live = true
    const id = setTimeout(
      () =>
        fetchReviewerOptions(pr.repo, pr.number, query.trim()).then(
          (o) => {
            if (!live) return
            setOptions({
              prId: o.prId,
              users: reviewerCandidates(o.suggested, o.assignable, [
                o.viewer,
                ...pr.requested.filter((r) => !r.team).map((r) => r.who),
              ]),
            })
            setError(undefined)
          },
          (e: unknown) =>
            live && setError(e instanceof Error ? e.message : String(e)),
        ),
      query ? SEARCH_DEBOUNCE_MS : 0,
    )
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [open, query, pr.repo, pr.number, pr.requested])

  async function pick(u: Reviewer) {
    if (!options) return
    setBusy(u.id)
    const { error } = await addReviewer(options.prId, u.id, pr.repo)
    setBusy(null)
    setError(error) // popover gardé ouvert : plusieurs reviewers d'affilée
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setQuery("")
          setOptions(null)
          setError(undefined)
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t.add}
            title={t.add}
          />
        }
      >
        <Plus />
      </PopoverTrigger>
      <PopoverContent align="start" className="gap-2 p-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.search}
          aria-label={t.search}
        />
        {error && <p className="px-2 text-xs text-destructive">{error}</p>}
        {!options ? (
          !error && (
            <Loader2 className="mx-auto my-2 size-4 animate-spin text-muted-foreground" />
          )
        ) : options.users.length ? (
          <ul className="flex max-h-64 flex-col overflow-y-auto">
            {options.users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => pick(u)}
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
                >
                  <Avatar login={u.login} url={pr.url} />
                  <span className="min-w-0 flex-1 truncate">{u.login}</span>
                  {busy === u.id && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-1 text-muted-foreground">{t.none}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
