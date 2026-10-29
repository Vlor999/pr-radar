import { cn } from "cn"
import { ChevronLeft, ChevronRight, Globe, Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { RunningDot } from "@/components/running-dot"
import { Button } from "@/components/ui/button"
import { strings, useStrings } from "@/lib/i18n"
import { loadWebStatus, useWebStatus } from "@/lib/web"

const S = strings(
  {
    toggle: "État de la version web",
    on: (host: string) => `Active · ${host}`,
    off: "Désactivée",
    start: "Démarrer le serveur",
    stop: "Arrêter le serveur",
    settings: "Réglages web",
  },
  {
    toggle: "Web version status",
    on: (host: string) => `On · ${host}`,
    off: "Off",
    start: "Start the server",
    stop: "Stop the server",
    settings: "Web settings",
  },
)

/**
 * boutons du groupe : zone grise commune au survol du groupe, gris un peu plus foncé sur le bouton
 * survolé, qui remplit sa moitié du groupe (bg-clip-border : pas de liseré sous la bordure transparente)
 */
const PART =
  "bg-clip-border hover:bg-foreground/[0.06] aria-expanded:bg-foreground/[0.06] dark:hover:bg-foreground/10 dark:aria-expanded:bg-foreground/10"

/**
 * « Ouvrir dans le navigateur » + chevron, un seul contrôle. Le chevron ouvre à gauche du globe, dans
 * l'en-tête, une bulle : état du serveur (cliquable : démarre / arrête) et lien vers la page de la
 * version web. Fermée par un clic dehors ou Échap.
 */
export function WebMenu({
  label,
  busy,
  onOpen,
  onToggle,
  onSettings,
}: {
  label: string
  busy: boolean
  onOpen: () => void
  onToggle: () => void
  onSettings: () => void
}) {
  const t = useStrings(S)
  const status = useWebStatus()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const chevron = useRef<HTMLButtonElement>(null)

  // pastille du globe : statut lu au montage, puis tenu à jour par les actions (lib/web.ts)
  useEffect(() => {
    loadWebStatus().catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    loadWebStatus().catch(() => {})
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    // capture : Échap ferme la bulle sans fermer aussi la page affichée dessous
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      setOpen(false)
      chevron.current?.focus()
    }
    document.addEventListener("pointerdown", onDown)
    window.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [open])

  const running = !!status?.running
  const state = status && (running ? t.on(`127.0.0.1:${status.port}`) : t.off)
  return (
    // ordre du DOM : globe, chevron, puis bulle (Tab juste après le chevron) ; affichée à gauche
    <div ref={box} className="flex flex-row-reverse items-center gap-2">
      <div
        className={cn(
          "flex items-center rounded-lg transition-colors hover:bg-muted dark:hover:bg-muted/50",
          open && "bg-muted dark:bg-muted/50",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          title={label}
          disabled={busy}
          onClick={onOpen}
          className={cn("relative rounded-none rounded-l-lg", PART)}
        >
          {busy ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Globe />
          )}
          {running && <RunningDot />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.toggle}
          title={t.toggle}
          ref={chevron}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn("h-9 w-6 rounded-none rounded-r-lg", PART)}
        >
          <ChevronLeft
            className={cn(
              "transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </Button>
      </div>
      {open && (
        <div className="flex items-center gap-1 rounded-full border bg-card p-1 text-xs shadow-sm duration-200 animate-in fade-in slide-in-from-right-2 motion-reduce:animate-none">
          <button
            type="button"
            disabled={busy || status === null}
            onClick={onToggle}
            aria-label={
              state ? `${state}, ${running ? t.stop : t.start}` : undefined
            }
            title={running ? t.stop : t.start}
            className="flex h-6 items-center gap-2 rounded-full px-2 whitespace-nowrap tabular-nums transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60 motion-reduce:transition-none"
          >
            {busy ? (
              <Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  running ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
            )}
            <span>{state ?? "…"}</span>
          </button>
          <Button
            variant="outline"
            size="xs"
            className="rounded-full"
            onClick={() => {
              setOpen(false)
              onSettings()
            }}
          >
            {t.settings}
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      )}
    </div>
  )
}
