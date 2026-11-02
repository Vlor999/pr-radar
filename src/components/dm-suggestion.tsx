import { Plus, X } from "lucide-react"
import { cn } from "cn"
import { useState } from "react"

import { Avatar } from "@/components/avatar"
import { SlackLogo } from "@/components/slack-logo"
import { Button } from "@/components/ui/button"
import { dismissDmSuggestion } from "@/hooks/use-dm-suggestions"
import { addReviewer } from "@/lib/actions"
import { strings, useStrings } from "@/lib/i18n"
import { pause } from "@/lib/motion"
import type { Reviewer } from "@/lib/reviewers"
import type { Pr } from "@/lib/types"

/** remplissage vert du rectangle avant que la ligne ne passe « En attente » (entrée : 300 ms, ui.md) */
const FILL_MS = 300

const S = strings(
  {
    request: (login: string) =>
      `${login} : contacté sur Slack, demander une review`,
    dismiss: (login: string) => `Ne plus proposer ${login}`,
  },
  {
    request: (login: string) =>
      `${login}: contacted on Slack, request a review`,
    dismiss: (login: string) => `Stop suggesting ${login}`,
  },
)

/**
 * Reviewer fantôme (pointillé, grisé) : destinataire d'un de mes DM Slack sur la PR, pas encore reviewer.
 * Un clic remplit le rectangle de vert puis demande la review (la ligne passe « En attente ») ; la croix
 * écarte la suggestion pour cette PR. Refus de GitHub : la suggestion revient, vide, l'erreur sous la liste.
 */
export function DmSuggestion({ pr, user }: { pr: Pr; user: Reviewer }) {
  const t = useStrings(S)
  const [filling, setFilling] = useState(false)

  async function request() {
    if (filling) return
    setFilling(true)
    await pause(FILL_MS) // animations réduites : tout de suite
    addReviewer(pr.id, user, { repo: pr.repo, url: pr.url })
  }

  return (
    <li className="relative -mx-1.5 flex items-center gap-1 overflow-hidden rounded-lg border border-dashed py-0.5 pr-0.5 pl-1.5 text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 origin-left bg-primary/15 transition-transform duration-300 ease-out motion-reduce:transition-none",
          filling ? "scale-x-100" : "scale-x-0",
        )}
      />
      <button
        type="button"
        onClick={request}
        aria-label={t.request(user.login)}
        title={t.request(user.login)}
        className="group/dm relative flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Avatar
          login={user.login}
          url={pr.url}
          className="opacity-60 transition-opacity duration-150 ease-out group-hover/dm:opacity-100"
        />
        <span className="min-w-0 flex-1 truncate">{user.login}</span>
        <SlackLogo mono className="size-3.5 shrink-0" />
        <Plus className="size-3.5 shrink-0" aria-hidden />
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="relative"
        onClick={() => dismissDmSuggestion(pr.url, user.login)}
        aria-label={t.dismiss(user.login)}
        title={t.dismiss(user.login)}
      >
        <X />
      </Button>
    </li>
  )
}
