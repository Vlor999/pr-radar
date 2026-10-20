import { Download, Loader2, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { installUpdate, useUpdate } from "@/lib/updater"
import { strings, useStrings } from "@/lib/i18n"

const S = strings(
  {
    available: "est disponible.",
    downloading: (version: string, pct: number | null) =>
      `Téléchargement de la version ${version}${pct !== null ? ` · ${pct} %` : "…"}`,
    ready: "Installée : redémarrage…",
    install: "Installer et redémarrer",
  },
  {
    available: "is available.",
    downloading: (version: string, pct: number | null) =>
      `Downloading version ${version}${pct !== null ? ` · ${pct}%` : "…"}`,
    ready: "Installed: restarting…",
    install: "Install and restart",
  },
)

/** Bandeau discret en haut de l'app quand une nouvelle version est prête à être installée. */
export function UpdateBanner() {
  const t = useStrings(S)
  const update = useUpdate()
  if (
    update.status !== "available" &&
    update.status !== "downloading" &&
    update.status !== "ready"
  )
    return null

  const pct =
    update.status === "downloading" && update.progress !== null
      ? Math.round(update.progress * 100)
      : null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm duration-300 animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none"
    >
      <Download className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        {update.status === "available" && (
          <>
            <span className="font-medium">PR Radar {update.version}</span>{" "}
            {t.available}
          </>
        )}
        {update.status === "downloading" && t.downloading(update.version, pct)}
        {update.status === "ready" && t.ready}
      </span>
      {update.status === "downloading" && (
        <span
          className="h-1.5 w-32 overflow-hidden rounded-full bg-primary/15"
          aria-hidden="true"
        >
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${pct ?? 15}%` }}
          />
        </span>
      )}
      {update.status === "available" && (
        <Button size="sm" onClick={() => void installUpdate()}>
          <RotateCw />
          {t.install}
        </Button>
      )}
      {update.status !== "available" && (
        <Loader2 className="size-4 animate-spin text-primary motion-reduce:animate-none" />
      )}
    </div>
  )
}
