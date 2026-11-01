import { getVersion } from "@tauri-apps/api/app"
import { Download, ExternalLink, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { buildCrashReport } from "@/lib/crash"
import { crashIssueUrl, type Crash, type CrashReport } from "@/lib/crash-data"
import { currentLang, strings, useStrings } from "@/lib/i18n"
import { exportLog } from "@/lib/log"
import { openExternal } from "@/lib/open"
import { isWeb } from "@/lib/platform"
import { contextBlock, osName, type ReportContext } from "@/lib/report"
import { useSettings } from "@/lib/settings"

const S = strings(
  {
    title: "Signaler le plantage sur GitHub",
    description:
      "Relis et modifie le rapport : il sera public. Jetons masqués, repos et comptes remplacés (repo-1, account-1…). L'app n'envoie rien : GitHub s'ouvre dans ton navigateur, tu publies toi-même.",
    issueTitle: "Titre",
    summary: "Résumé",
    logs: "Journal (avertissements et erreurs de la session)",
    noLogs: "Aucune ligne du journal pour cette session.",
    context: "Contexte",
    attach:
      "Le fichier du journal complet peut être joint à l'issue à la main : exporte-le puis glisse-le dans GitHub. Il n'est pas anonymisé, relis-le avant.",
    export: "Exporter le journal…",
    exported: "Exporté",
    open: "Ouvrir sur GitHub",
    cancel: "Annuler",
    loading: "Préparation du rapport…",
  },
  {
    title: "Report the crash on GitHub",
    description:
      "Review and edit the report: it will be public. Tokens masked, repos and accounts replaced (repo-1, account-1…). The app sends nothing: GitHub opens in your browser and you submit it yourself.",
    issueTitle: "Title",
    summary: "Summary",
    logs: "Log (warnings and errors of the session)",
    noLogs: "No log line for this session.",
    context: "Context",
    attach:
      "The full log file can be attached to the issue by hand: export it, then drop it into GitHub. It is not anonymized, review it first.",
    export: "Export log…",
    exported: "Exported",
    open: "Open on GitHub",
    cancel: "Cancel",
    loading: "Preparing the report…",
  },
)

/** Aperçu modifiable du rapport de plantage, puis issue préremplie ouverte dans le navigateur. */
export function CrashReportDialog({
  crash,
  open,
  onOpenChange,
  onOpened,
}: {
  crash: Crash
  open: boolean
  onOpenChange: (open: boolean) => void
  /** issue ouverte dans le navigateur */
  onOpened?: () => void
}) {
  const t = useStrings(S)
  const lang = currentLang(useSettings().lang)
  const [report, setReport] = useState<CrashReport | null>(null)
  const [ctx, setCtx] = useState<ReportContext>({
    version: null,
    os: osName(navigator.userAgent),
    web: isWeb,
  })
  const [exported, setExported] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    setReport(null)
    setExported(false)
    void buildCrashReport(crash, lang).then((r) => live && setReport(r))
    getVersion().then(
      (version) => live && setCtx((c) => ({ ...c, version })),
      () => {},
    )
    return () => {
      live = false
    }
  }, [open, crash, lang])

  const edit = (patch: Partial<CrashReport>) =>
    setReport((r) => r && { ...r, ...patch })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {!report ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            {t.loading}
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">{t.issueTitle}</span>
              <Input
                value={report.title}
                onChange={(e) => edit({ title: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">{t.summary}</span>
              <Textarea
                value={report.description}
                onChange={(e) => edit({ description: e.target.value })}
                className="max-h-60 font-mono text-xs md:text-xs"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">{t.logs}</span>
              <Textarea
                value={report.logs}
                placeholder={t.noLogs}
                onChange={(e) => edit({ logs: e.target.value })}
                className="max-h-60 font-mono text-xs break-all md:text-xs"
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="font-medium">{t.context}</span>
              <pre className="rounded-2xl bg-muted/50 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                {contextBlock(ctx, lang).replace(/^---\n### .*\n/, "")}
              </pre>
            </div>
            {!isWeb && (
              <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                <span className="min-w-0 flex-1">{t.attach}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void exportLog().then(
                      (path) => path && setExported(true),
                      () => {},
                    )
                  }
                >
                  <Download data-icon="inline-start" />
                  {exported ? t.exported : t.export}
                </Button>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            disabled={!report}
            onClick={() => {
              if (!report) return
              openExternal(crashIssueUrl(report, ctx, lang))
              onOpenChange(false)
              onOpened?.()
            }}
          >
            <ExternalLink data-icon="inline-start" />
            {t.open}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
