import { cn } from "cn"
import type { ReactNode } from "react"

import { useThumb } from "@/hooks/use-thumb"

// Briques des pages plein écran (réglages, serveur MCP) : section, ligne, interrupteur, choix segmenté.

export function Section(props: {
  id: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section
      id={props.id}
      aria-labelledby={`${props.id}-title`}
      className="scroll-mt-4"
    >
      <h2 id={`${props.id}-title`} className="text-base font-semibold">
        {props.title}
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {props.description}
      </p>
      <div className="mt-3 rounded-2xl border bg-card px-4">
        {props.children}
      </div>
    </section>
  )
}

export function Row(props: {
  label: ReactNode
  description?: ReactNode
  labelId?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 border-t py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
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
