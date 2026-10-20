import { useEffect, useRef, useState } from "react"
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"

import type { Pr } from "@/lib/types"

type Permission = "default" | "granted" | "denied"

/** Ce qui a changé sur une PR depuis le dernier chargement, en une phrase (ou null). */
function change(before: Pr, now: Pr): string | null {
  if (now.decision !== before.decision && now.decision === "APPROVED") return "approuvée"
  if (now.decision !== before.decision && now.decision === "CHANGES_REQUESTED")
    return "changements demandés"
  if (now.comments > before.comments) {
    const n = now.comments - before.comments
    return `${n} nouveau${n > 1 ? "x" : ""} commentaire${n > 1 ? "s" : ""}`
  }
  if (now.ci !== before.ci && (now.ci === "FAILURE" || now.ci === "ERROR")) return "CI en échec"
  return null
}

/** Notifications système (macOS, Windows, Linux) sur les changements entre deux rafraîchissements. */
export function usePrNotifications(prs: Pr[]) {
  const previous = useRef<Map<string, Pr> | null>(null)
  const [permission, setPermission] = useState<Permission>("default")

  useEffect(() => {
    isPermissionGranted()
      .then((ok) => ok && setPermission("granted"))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const current = new Map(prs.map((p) => [`${p.repo}#${p.number}`, p]))
    const before = previous.current
    previous.current = current
    if (!before || permission !== "granted") return
    for (const [key, now] of current) {
      const was = before.get(key)
      const what = was && change(was, now)
      if (what) sendNotification({ title: `${key} : ${what}`, body: now.title })
    }
  }, [prs, permission])

  const enable = async () => setPermission((await requestPermission()) as Permission)
  return { permission, enable }
}
