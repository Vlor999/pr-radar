import { Bug, TriangleAlert, X } from "lucide-react"
import { useState } from "react"

import { CrashReportDialog } from "@/components/crash-report-dialog"
import { Button } from "@/components/ui/button"
import { dismissCrash, usePreviousCrash } from "@/lib/crash"
import type { CrashKind } from "@/lib/crash-data"
import { strings, useStrings } from "@/lib/i18n"

const S = strings(
  {
    stopped: "PR Radar s'est arrêté de façon inattendue.",
    kinds: {
      panic: "Erreur interne de l'app.",
      webview: "Erreur de l'interface.",
      unclean: "La session précédente ne s'est pas fermée normalement.",
    } satisfies Record<CrashKind, string>,
    report: "Signaler sur GitHub",
    dismiss: "Ignorer",
  },
  {
    stopped: "PR Radar stopped unexpectedly.",
    kinds: {
      panic: "Internal app error.",
      webview: "Interface error.",
      unclean: "The previous session did not close normally.",
    },
    report: "Report on GitHub",
    dismiss: "Dismiss",
  },
)

/** Bandeau non bloquant au lancement qui suit un plantage : signaler (aperçu du rapport) ou ignorer. */
export function CrashBanner() {
  const t = useStrings(S)
  const crash = usePreviousCrash()
  const [open, setOpen] = useState(false)
  if (!crash) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm duration-300 animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none"
    >
      <TriangleAlert className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t.stopped}</span>{" "}
        <span className="text-muted-foreground">{t.kinds[crash.kind]}</span>
      </span>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Bug data-icon="inline-start" />
        {t.report}
      </Button>
      <Button size="sm" variant="ghost" onClick={dismissCrash}>
        <X data-icon="inline-start" />
        {t.dismiss}
      </Button>
      <CrashReportDialog
        crash={crash}
        open={open}
        onOpenChange={setOpen}
        // rapport ouvert dans le navigateur : le bandeau a servi
        onOpened={dismissCrash}
      />
    </div>
  )
}
