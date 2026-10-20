import { Download, Loader2, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { installUpdate, useUpdate } from "@/lib/updater"

/** Bandeau discret en haut de l'app quand une nouvelle version est prête à être installée. */
export function UpdateBanner() {
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
            <span className="font-medium">PR Radar {update.version}</span> est
            disponible.
          </>
        )}
        {update.status === "downloading" &&
          `Téléchargement de la version ${update.version}${pct !== null ? ` · ${pct} %` : "…"}`}
        {update.status === "ready" && "Installée : redémarrage…"}
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
          Installer et redémarrer
        </Button>
      )}
      {update.status !== "available" && (
        <Loader2 className="size-4 animate-spin text-primary motion-reduce:animate-none" />
      )}
    </div>
  )
}
