import { useEffect, useState } from "react"
import { cn } from "cn"

import { REFRESH_OK_VISIBLE_MS } from "@/lib/constants"
import { locale, strings, useStrings } from "@/lib/i18n"
import { useData } from "@/lib/store"

const S = strings(
  {
    loading: "Actualisation en cours",
    ok: (time: string) => `Actualisé à ${time}`,
    partial: (time: string, e: string) =>
      `Actualisation partielle à ${time} : ${e}`,
    failed: (time: string, e: string) =>
      `Actualisation en échec à ${time} : ${e}`,
  },
  {
    loading: "Refreshing",
    ok: (time: string) => `Refreshed at ${time}`,
    partial: (time: string, e: string) => `Partial refresh at ${time}: ${e}`,
    failed: (time: string, e: string) => `Refresh failed at ${time}: ${e}`,
  },
)

const COLOR = {
  loading: "bg-muted-foreground/50",
  ok: "bg-emerald-500",
  partial: "bg-amber-500",
  failed: "bg-destructive",
}

/** temps restant avant l'effacement de la pastille verte d'une actualisation finie à `at` */
const okLeft = (at: string) =>
  REFRESH_OK_VISIBLE_MS - (Date.now() - Date.parse(at))

/**
 * Pastille à gauche du bouton « Rafraîchir » : grise pendant une actualisation automatique,
 * puis l'issue de la dernière (verte qui s'efface, orange ou rouge jusqu'à la suivante).
 * Masquée pendant une actualisation manuelle : l'icône du bouton tourne déjà.
 */
export function RefreshDot({
  auto,
  manual,
}: {
  auto: boolean
  manual: boolean
}) {
  const t = useStrings(S)
  const { status, statusAt, error, mergedError } = useData()
  // fin de l'actualisation réussie dont la pastille s'est effacée ; au remontage, une réussite
  // plus ancienne que le délai est déjà effacée (pas de pastille verte rejouée)
  const [faded, setFaded] = useState(() =>
    statusAt && okLeft(statusAt) <= 0 ? statusAt : undefined,
  )
  useEffect(() => {
    if (status !== "ok" || !statusAt) return
    const id = setTimeout(() => setFaded(statusAt), okLeft(statusAt))
    return () => clearTimeout(id)
  }, [status, statusAt])

  const state = auto ? "loading" : status
  const visible = !manual && !!state && !(state === "ok" && faded === statusAt)
  const time = statusAt
    ? new Date(statusAt).toLocaleTimeString(locale(), {
        hour: "2-digit",
        minute: "2-digit",
      })
    : ""
  // échec global : `mergedError` est celui du chargement précédent, seule `error` vaut
  const detail = (state === "failed" ? [error] : [error, mergedError])
    .filter(Boolean)
    .join(" ; ")
  const label =
    state === "loading"
      ? t.loading
      : state === "ok"
        ? t.ok(time)
        : state === "partial"
          ? t.partial(time, detail)
          : state === "failed"
            ? t.failed(time, detail)
            : undefined

  return (
    <span
      {...(visible
        ? { role: "img", "aria-label": label, title: label }
        : { "aria-hidden": true })}
      className={cn(
        "size-2 shrink-0 rounded-full transition-opacity duration-300 ease-out motion-reduce:transition-none",
        state && COLOR[state],
        !visible && "opacity-0",
      )}
    />
  )
}
