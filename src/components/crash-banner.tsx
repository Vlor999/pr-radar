import { Bug, TriangleAlert, X } from "lucide-react"
import { useState } from "react"

import { CrashReportDialog } from "@/components/crash-report-dialog"
import { Button } from "@/components/ui/button"
import { dismissCrash, usePreviousCrash } from "@/lib/crash"
import type { CrashKind } from "@/lib/crash-data"
import { strings, useStrings } from "@/lib/i18n"

const S = strings(
  {
    headline: {
      panic: "PR Radar s'est arrêté de façon inattendue.",
      webview: "PR Radar s'est arrêté de façon inattendue.",
      unclean: "PR Radar a été fermé de façon inattendue.",
    } satisfies Record<CrashKind, string>,
    kinds: {
      panic: "Erreur interne de l'app.",
      webview: "Erreur de l'interface.",
      unclean: "Si c'était un plantage, tu peux le signaler.",
    } satisfies Record<CrashKind, string>,
    report: "Signaler sur GitHub",
    dismiss: "Ignorer",
  },
  {
    headline: {
      panic: "PR Radar stopped unexpectedly.",
      webview: "PR Radar stopped unexpectedly.",
      unclean: "PR Radar was closed unexpectedly.",
    },
    kinds: {
      panic: "Internal app error.",
      webview: "Interface error.",
      unclean: "If it was a crash, you can report it.",
    },
    report: "Report on GitHub",
    dismiss: "Dismiss",
  },
)

/**
 * Bandeau non bloquant au lancement qui suit un plantage : signaler (aperçu du rapport) ou ignorer.
 * Rust ne renvoie le plantage qu'une fois (`crash_status`) : une fenêtre rechargée ne le revoit pas.
 */
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
        <span className="font-medium">{t.headline[crash.kind]}</span>{" "}
        <span className="text-muted-foreground">{t.kinds[crash.kind]}</span>
      </span>
      {/* fermeture sans panic (souvent pas un plantage) : signaler en action secondaire */}
      <Button
        size="sm"
        variant={crash.kind === "unclean" ? "outline" : "default"}
        onClick={() => setOpen(true)}
      >
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
