import { Fragment } from "react"
import { Command, CornerDownLeft } from "lucide-react"
import { cn } from "cn"

import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { strings, useStrings } from "@/lib/i18n"

const S = strings(
  { esc: "Échap", ctrl: "Ctrl", cmd: "Commande", enter: "Entrée", or: "ou" },
  { esc: "Esc", ctrl: "Ctrl", cmd: "Command", enter: "Enter", or: "or" },
)

/** macOS (app ou navigateur) : raccourcis avec ⌘, sinon Ctrl. */
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)

/** `mod` : ⌘ sur macOS, Ctrl ailleurs ; `enter`, `esc` ; sinon le caractère tel quel. */
export type ShortcutKey = "mod" | "enter" | "esc" | (string & {})

/** Une combinaison (`["mod", "k"]`) ou des alternatives (`[["j"], ["k"]]`, affichées « j / k »). */
export type ShortcutKeys = ShortcutKey[] | ShortcutKey[][]

/** Touches d'un raccourci : une touche par cabochon, même hauteur, glyphe centré. */
export function Shortcut({
  keys,
  className,
}: {
  keys: ShortcutKeys
  className?: string
}) {
  const t = useStrings(S)
  const combos = (Array.isArray(keys[0]) ? keys : [keys]) as ShortcutKey[][]
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {combos.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-label={t.or} className="text-muted-foreground">
              /
            </span>
          )}
          <KbdGroup>
            {combo.map((k, j) => (
              <Kbd key={j}>
                {k === "mod" ? (
                  IS_MAC ? (
                    <Command aria-label={t.cmd} />
                  ) : (
                    t.ctrl
                  )
                ) : k === "enter" ? (
                  <CornerDownLeft aria-label={t.enter} />
                ) : k === "esc" ? (
                  t.esc
                ) : (
                  k
                )}
              </Kbd>
            ))}
          </KbdGroup>
        </Fragment>
      ))}
    </span>
  )
}
