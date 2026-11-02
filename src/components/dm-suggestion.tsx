import { Plus, X } from "lucide-react"

import { Avatar } from "@/components/avatar"
import { Button } from "@/components/ui/button"
import { dismissDmSuggestion } from "@/hooks/use-dm-suggestions"
import { addReviewer } from "@/lib/actions"
import { strings, useStrings } from "@/lib/i18n"
import type { Reviewer } from "@/lib/reviewers"
import type { Pr } from "@/lib/types"

const S = strings(
  {
    slack: "DM Slack",
    request: (login: string) =>
      `${login} : contacté sur Slack, demander une review`,
    dismiss: (login: string) => `Ne plus proposer ${login}`,
  },
  {
    slack: "Slack DM",
    request: (login: string) =>
      `${login}: contacted on Slack, request a review`,
    dismiss: (login: string) => `Stop suggesting ${login}`,
  },
)

/**
 * Reviewer fantôme (pointillé, grisé) : destinataire d'un de mes DM Slack sur la PR, pas encore reviewer.
 * Un clic demande la review sans passer par le « + » ; la croix écarte la suggestion pour cette PR.
 */
export function DmSuggestion({ pr, user }: { pr: Pr; user: Reviewer }) {
  const t = useStrings(S)
  return (
    <li className="-mx-1.5 flex items-center gap-1 rounded-lg border border-dashed py-0.5 pr-0.5 pl-1.5 text-muted-foreground">
      <button
        type="button"
        onClick={() => addReviewer(pr.id, user, { repo: pr.repo, url: pr.url })}
        aria-label={t.request(user.login)}
        title={t.request(user.login)}
        className="group/dm flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Avatar
          login={user.login}
          url={pr.url}
          className="opacity-60 transition-opacity duration-150 ease-out group-hover/dm:opacity-100"
        />
        <span className="min-w-0 flex-1 truncate">{user.login}</span>
        <span className="text-xs">{t.slack}</span>
        <Plus className="size-3.5" aria-hidden />
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => dismissDmSuggestion(pr.url, user.login)}
        aria-label={t.dismiss(user.login)}
        title={t.dismiss(user.login)}
      >
        <X />
      </Button>
    </li>
  )
}
