import { cn } from "cn"
import { useState } from "react"

/**
 * Avatar GitHub d'un login, déduit de l'URL de la PR / du commentaire : seulement sur github.com
 * (sur un GitHub Enterprise, le même login est une autre personne). Sinon, ou en cas d'échec : l'initiale.
 */
export function Avatar({
  login,
  url,
  className,
}: {
  login: string
  /** URL GitHub de l'objet (PR, commentaire) : donne l'hôte */
  url?: string
  className?: string
}) {
  // échec mémorisé pour cette image : un autre login retente le chargement
  const src = `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=64`
  const [failedSrc, setFailedSrc] = useState("")
  const base = cn(
    "size-5 shrink-0 rounded-full bg-muted ring-2 ring-card",
    className,
  )
  if (failedSrc === src || !url?.startsWith("https://github.com/"))
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "grid place-items-center text-[10px] font-medium uppercase",
        )}
      >
        {login[0]}
      </span>
    )
  return (
    <img src={src} alt="" onError={() => setFailedSrc(src)} className={base} />
  )
}
