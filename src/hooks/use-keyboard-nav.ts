import { useEffect } from "react"

import { strings } from "@/lib/i18n"
import { openExternal } from "@/lib/open"

/** À lire avec `useStrings(SHORTCUTS)`. */
export const SHORTCUTS = strings(
  [
    { keys: "/", label: "rechercher" },
    { keys: "j / k", label: "carte suivante / précédente" },
    { keys: "o", label: "ouvrir sur GitHub" },
    { keys: "e", label: "déplier / replier" },
    { keys: "d", label: "clair / sombre" },
  ],
  [
    { keys: "/", label: "search" },
    { keys: "j / k", label: "next / previous card" },
    { keys: "o", label: "open on GitHub" },
    { keys: "e", label: "expand / collapse" },
    { keys: "d", label: "light / dark" },
  ],
)

const CARD = "[data-pr-card]"

export function useKeyboardNav(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return

      const target = event.target as HTMLElement | null
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      ) {
        if (event.key === "Escape" && target.id === "search") target.blur()
        return
      }

      const active = document.activeElement as HTMLElement | null
      const onCard = !!active?.matches(CARD)

      switch (event.key) {
        case "/": {
          const search = document.getElementById(
            "search",
          ) as HTMLInputElement | null
          if (!search) return
          event.preventDefault()
          search.focus()
          search.select()
          break
        }
        case "j":
        case "k": {
          const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD))
          if (!cards.length) return
          event.preventDefault()
          const next = event.key === "j" ? 1 : -1
          const i = onCard
            ? cards.indexOf(active as HTMLElement) + next
            : next > 0
              ? 0
              : cards.length - 1
          const el =
            cards.at(Math.min(Math.max(i, 0), cards.length - 1)) ?? cards[0]
          el.focus({ preventScroll: true })
          el.scrollIntoView({ block: "nearest" })
          break
        }
        case "o":
          if (onCard && active!.dataset.url) openExternal(active!.dataset.url)
          break
        case "e":
          if (onCard) active!.click()
          break
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
