import { Plus } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { UserCommand } from "@/components/user-command"
import { addReviewer } from "@/lib/actions"
import { fetchReviewerOptions } from "@/lib/github"
import { strings, useStrings } from "@/lib/i18n"
import {
  dmNames as namesOf,
  dmRecipients,
  matchRecipients,
  reviewerCandidates,
  type Reviewer,
} from "@/lib/reviewers"
import { useMentions } from "@/lib/slack"
import { usePendingReviews } from "@/lib/store"
import type { Pr } from "@/lib/types"

const SEARCH_DEBOUNCE_MS = 250 // une requête GraphQL par frappe sinon

const S = strings(
  {
    add: "Ajouter un reviewer",
  },
  {
    add: "Add a reviewer",
  },
)

type Options = {
  prId: string
  viewer: string
  suggested: Reviewer[]
  assignable: Reviewer[]
  dm: Reviewer[]
}

/** Bouton « + » des reviewers : destinataires de mes DM Slack sur la PR, suggestions GitHub, puis recherche
 * parmi les utilisateurs assignables. Un clic demande la review en arrière-plan ; le popover reste utilisable. */
export function AddReviewer({ pr }: { pr: Pr }) {
  const t = useStrings(S)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<Options | null>(null)
  const [error, setError] = useState<string>()
  const { pending } = usePendingReviews(pr.url)
  const recipients = dmRecipients(useMentions(pr.url))
  // noms Slack des destinataires, cherchés parmi les utilisateurs assignables seulement sans recherche tapée
  // (une recherche tapée filtre déjà, pas d'alias GraphQL à chaque frappe). Chaîne : clé stable de l'effet.
  const dmNames = namesOf(recipients).join("\n")
  const q = query.trim()

  useEffect(() => {
    if (!open) return
    let live = true
    const id = setTimeout(
      () =>
        fetchReviewerOptions(
          pr.repo,
          pr.number,
          q,
          q || !dmNames ? [] : dmNames.split("\n"),
        ).then(
          (o) => {
            if (!live) return
            setOptions(o)
            setError(undefined)
          },
          (e: unknown) => {
            if (!live) return
            setOptions(null) // pas d'anciens résultats sous l'erreur d'une nouvelle recherche
            setError(e instanceof Error ? e.message : String(e))
          },
        ),
      q ? SEARCH_DEBOUNCE_MS : 0,
    )
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [open, q, pr.repo, pr.number, dmNames])

  // calculés au rendu : un reviewer demandé (même pas encore confirmé) quitte la liste aussitôt
  const users =
    options &&
    reviewerCandidates(
      options.suggested,
      options.assignable,
      [
        options.viewer,
        ...(pr.involved ? [pr.involved.author] : []),
        ...pr.requested.filter((r) => !r.team).map((r) => r.who),
        ...pending.map((p) => p.login),
      ],
      matchRecipients(recipients, [
        ...options.dm,
        ...options.suggested,
        ...options.assignable,
      ]),
    )

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
      <PopoverContent align="start" aria-label={t.add} className="p-2">
        <UserCommand
          query={query}
          onQueryChange={setQuery}
          users={users}
          error={error}
          url={pr.url}
          onPick={(u) =>
            options &&
            addReviewer(options.prId, u, { repo: pr.repo, url: pr.url })
          }
        />
      </PopoverContent>
    </Popover>
  )
}
