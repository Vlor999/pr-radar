import { Bug, RotateCw, TriangleAlert } from "lucide-react"
import { Component, useState, type ErrorInfo, type ReactNode } from "react"

import { CrashReportDialog } from "@/components/crash-report-dialog"
import { Button } from "@/components/ui/button"
import { logRenderCrash, webviewCrash } from "@/lib/crash"
import type { Crash } from "@/lib/crash-data"
import { strings, useStrings } from "@/lib/i18n"

const S = strings(
  {
    title: "L'interface de PR Radar a planté.",
    hint: "Recharger la fenêtre suffit en général. Tes réglages et tes comptes sont gardés.",
    reload: "Recharger",
    report: "Signaler",
  },
  {
    title: "PR Radar's interface crashed.",
    hint: "Reloading the window usually fixes it. Your settings and accounts are kept.",
    reload: "Reload",
    report: "Report",
  },
)

/** Écran lisible à la place d'une interface plantée : recharger, ou signaler le plantage. */
function CrashFallback({ crash }: { crash: Crash }) {
  const t = useStrings(S)
  const [open, setOpen] = useState(false)
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <TriangleAlert className="size-8 text-destructive" />
      <div className="flex max-w-md flex-col gap-1.5">
        <p className="font-medium">{t.title}</p>
        <p className="text-sm text-muted-foreground">{t.hint}</p>
        {crash.message && (
          <code className="mt-2 rounded-xl bg-muted/50 px-3 py-2 text-xs break-all text-muted-foreground">
            {crash.message}
          </code>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => location.reload()}>
          <RotateCw data-icon="inline-start" />
          {t.reload}
        </Button>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Bug data-icon="inline-start" />
          {t.report}
        </Button>
      </div>
      <CrashReportDialog crash={crash} open={open} onOpenChange={setOpen} />
    </main>
  )
}

/** Racine de l'app : une erreur de rendu affiche `CrashFallback` au lieu d'une fenêtre vide. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { crash: Crash | null }
> {
  state = { crash: null as Crash | null }

  static getDerivedStateFromError(e: unknown) {
    return { crash: webviewCrash(e) }
  }

  componentDidCatch(e: unknown, info: ErrorInfo) {
    logRenderCrash(e, info.componentStack)
  }

  render() {
    return this.state.crash ? (
      <CrashFallback crash={this.state.crash} />
    ) : (
      this.props.children
    )
  }
}
