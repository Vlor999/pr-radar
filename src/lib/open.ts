import { openUrl } from "@tauri-apps/plugin-opener"

/** Ouvre une adresse dans le navigateur du système (la fenêtre de l'app n'ouvre pas d'onglets). */
export function openExternal(url: string) {
  openUrl(url).catch(() => window.open(url, "_blank", "noopener"))
}

/** Tous les liens http(s) de l'app s'ouvrent dans le navigateur du système. */
export function routeLinksToBrowser() {
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.(
      "a[href]",
    ) as HTMLAnchorElement | null
    if (!a || !/^https?:/.test(a.href) || e.defaultPrevented) return
    e.preventDefault()
    openExternal(a.href)
  })
}
