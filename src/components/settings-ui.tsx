import { cn } from "cn"
import { ChevronRight } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { useThumb } from "@/hooks/use-thumb"
import { strings, useStrings } from "@/lib/i18n"

const S = strings({ done: "Fait" }, { done: "Done" })

/** durée du libellé « Fait » après une action */
const FLASH_MS = 2_000
/** fenêtre du second clic d'une confirmation */
const CONFIRM_MS = 4_000

// Briques des pages plein écran (réglages, serveur MCP, version web) : section, ligne, interrupteur,
// choix segmenté, confirmation, retour « Fait ».

export function Section(props: {
  id: string
  title: string
  description?: string
  /** zone sensible : bordure et titre rouges */
  destructive?: boolean
  /** repliable : contenu masqué tant que `open` est faux */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  const collapsible = props.onOpenChange !== undefined
  const shown = !collapsible || !!props.open
  return (
    <section
      id={props.id}
      aria-labelledby={`${props.id}-title`}
      // surlignage (recherche) : sur la carte seulement, voir plus bas
      className="scroll-mt-24 outline-none"
    >
      <h2
        id={`${props.id}-title`}
        className={cn(
          "text-base font-semibold",
          props.destructive && "text-destructive",
        )}
      >
        {collapsible ? (
          <button
            type="button"
            aria-expanded={shown}
            aria-controls={shown ? `${props.id}-body` : undefined}
            onClick={() => props.onOpenChange?.(!shown)}
            className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                "size-4 text-muted-foreground transition-transform motion-reduce:transition-none",
                shown && "rotate-90",
              )}
            />
            {props.title}
          </button>
        ) : (
          props.title
        )}
      </h2>
      {props.description && (
        <p className="mt-0.5 text-sm text-muted-foreground">
          {props.description}
        </p>
      )}
      {shown && (
        <div
          id={`${props.id}-body`}
          // overflow-hidden : le surlignage d'une ligne (-mx-4, bord à bord) suit les coins arrondis ;
          // rien n'en déborde (pas de popover, anneaux de focus dans le px-4).
          // Section surlignée (data-highlight sur <section>) : bordure et fond teintés de la carte,
          // même langage que la ligne surlignée, titre et description intacts.
          className={cn(
            "mt-3 overflow-hidden rounded-2xl border bg-card px-4 transition-colors duration-500 motion-reduce:transition-none",
            props.destructive &&
              "border-destructive/40 *:border-destructive/20",
            "in-data-[highlight]:border-primary/50 in-data-[highlight]:bg-[color-mix(in_oklch,var(--card),var(--primary)_8%)]",
          )}
        >
          {props.children}
        </div>
      )}
    </section>
  )
}

/** Id DOM d'une ligne de réglage, cible de la recherche des réglages. */
export const settingDomId = (id: string) => `setting-${id}`

export function Row(props: {
  label: ReactNode
  description?: ReactNode
  labelId?: string
  /** id stable du réglage, repris par l'index de recherche */
  id?: string
  children?: ReactNode
}) {
  return (
    <div
      id={props.id && settingDomId(props.id)}
      className="-mx-4 flex scroll-mt-24 flex-col gap-2 border-t px-4 py-3 outline-none transition-colors duration-500 first:border-t-0 data-[highlight]:bg-primary/10 motion-reduce:transition-none sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <div className="min-w-0">
        <div id={props.labelId} className="text-sm font-medium">
          {props.label}
        </div>
        {props.description && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {props.description}
          </div>
        )}
      </div>
      {props.children && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {props.children}
        </div>
      )}
    </div>
  )
}

export function Toggle(props: {
  checked: boolean
  onChange: (v: boolean) => void
  labelledBy: string
  muted?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-labelledby={props.labelledBy}
      onClick={() => props.onChange(!props.checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none",
        props.checked ? "bg-primary" : "bg-input",
        props.muted && "opacity-50",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
          props.checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

export function Segmented<T extends string | number>(props: {
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (v: T) => void
  labelledBy: string
}) {
  const [box, thumb] = useThumb<HTMLDivElement>(
    '[aria-checked="true"]',
    props.value,
  )
  return (
    <div
      ref={box}
      role="radiogroup"
      aria-labelledby={props.labelledBy}
      className="relative inline-flex flex-wrap rounded-lg border bg-muted p-0.5"
    >
      {thumb && (
        <span
          aria-hidden
          style={thumb}
          className="absolute rounded-md bg-background shadow-sm transition-[left,top,width,height] duration-200 ease-out motion-reduce:transition-none"
        />
      )}
      {props.options.map((o) => {
        const active = o.value === props.value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => props.onChange(o.value)}
            className={cn(
              "relative inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none [&_svg]:size-3.5",
              active
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Libellé « Fait » affiché 2 s après une action. */
export function useFlash(): [string | null, (msg?: string) => void] {
  const t = useStrings(S)
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    msg,
    (m = t.done) => {
      setMsg(m)
      clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setMsg(null), FLASH_MS)
    },
  ]
}

/** Confirmation en deux clics : le premier arme le bouton pendant 4 s. */
export function useConfirm(): [boolean, (action: () => void) => void] {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    armed,
    (action) => {
      clearTimeout(timer.current)
      if (armed) {
        setArmed(false)
        action()
      } else {
        setArmed(true)
        timer.current = window.setTimeout(() => setArmed(false), CONFIRM_MS)
      }
    },
  ]
}

export const Feedback = ({ msg }: { msg: string | null }) => (
  <span aria-live="polite" className="min-w-8 text-xs text-muted-foreground">
    {msg}
  </span>
)
