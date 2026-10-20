import { useEffect, useSyncExternalStore } from "react"

/** Clair / sombre / auto (suit le système). Classe `dark` sur <html>, choix gardé dans l'app. */
export type ThemeMode = "light" | "dark" | "system"

const KEY = "pr-radar:theme"
const listeners = new Set<() => void>()
const media = window.matchMedia("(prefers-color-scheme: dark)")

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

function apply() {
  const mode = read()
  const dark = mode === "dark" || (mode === "system" && media.matches)
  document.documentElement.classList.toggle("dark", dark)
}

export function setTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {}
  apply()
  listeners.forEach((l) => l())
}

export function useTheme() {
  const theme = useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, read)
  return { theme, setTheme }
}

/** À monter une fois : applique le thème, suit le système et active la touche `d`. */
export function useThemeEffects() {
  useEffect(() => {
    apply()
    media.addEventListener("change", apply)
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== "d" || e.metaKey || e.ctrlKey || e.altKey || e.repeat)
        return
      if (t?.matches("input, textarea, select") || t?.isContentEditable) return
      setTheme(
        document.documentElement.classList.contains("dark") ? "light" : "dark",
      )
    }
    window.addEventListener("keydown", onKey)
    return () => {
      media.removeEventListener("change", apply)
      window.removeEventListener("keydown", onKey)
    }
  }, [])
}
