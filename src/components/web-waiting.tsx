import { Loader2 } from "lucide-react"

import { strings, useStrings } from "@/lib/i18n"

const S = strings(
  {
    waiting:
      "En attente de l'app PR Radar… Garde-la ouverte (fenêtre ou barre des menus) : cette page se charge dès qu'elle répond.",
  },
  {
    waiting:
      "Waiting for the PR Radar app… Keep it open (window or menu bar): this page loads as soon as it answers.",
  },
)

/** Version web : l'app n'a pas encore envoyé ses réglages (lancement en cours, ou app fermée). */
export function WebWaiting() {
  const t = useStrings(S)
  return (
    <main className="flex min-h-svh items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
      <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      <p className="max-w-md">{t.waiting}</p>
    </main>
  )
}
