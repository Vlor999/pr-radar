import { useEffect, useRef } from "react"
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"

import { getSettings, type Settings } from "@/lib/settings"
import type { Pr } from "@/lib/types"

type Permission = "default" | "granted" | "denied"

type Kind = keyof Settings["notify"]

/** Ce qui a changé sur une PR depuis le dernier chargement : type (réglable) et phrase, ou null. */
function change(before: Pr, now: Pr): { kind: Kind; text: string } | null {
  if (now.decision !== before.decision && now.decision === "APPROVED")
    return { kind: "approved", text: "approuvée" }
  if (now.decision !== before.decision && now.decision === "CHANGES_REQUESTED")
    return { kind: "changesRequested", text: "changements demandés" }
  if (now.comments > before.comments) {
    const n = now.comments - before.comments
    return {
      kind: "comments",
      text: `${n} nouveau${n > 1 ? "x" : ""} commentaire${n > 1 ? "s" : ""}`,
    }
  }
  if (now.ci !== before.ci && (now.ci === "FAILURE" || now.ci === "ERROR"))
    return { kind: "ciFailed", text: "CI en échec" }
  return null
}

/** Notifications système (macOS, Windows, Linux) sur les changements entre deux rafraîchissements. */
export function usePrNotifications(prs: Pr[]) {
  const previous = useRef<Map<string, Pr> | null>(null)

  useEffect(() => {
    const current = new Map(prs.map((p) => [`${p.repo}#${p.number}`, p]))
    const before = previous.current
    previous.current = current
    if (!before) return
    const changes = [...current].flatMap(([key, now]) => {
      const was = before.get(key)
      const what = was && change(was, now)
      return what && getSettings().notify[what.kind] ? [{ key, now, what }] : []
    })
    if (!changes.length) return
    isPermissionGranted().then((ok) => {
      if (!ok) return
      for (const { key, now, what } of changes)
        sendNotification({ title: `${key} : ${what.text}`, body: now.title })
    })
  }, [prs])
}

/** Réglages > Notifications : état de l'autorisation système, sans rien demander. */
export async function notificationPermission(): Promise<Permission> {
  return (await isPermissionGranted().catch(() => false))
    ? "granted"
    : "default"
}

/** Demande l'autorisation au système (affiche la boîte de dialogue la première fois). */
export async function requestNotifications(): Promise<Permission> {
  return (await requestPermission()) as Permission
}

/** Bouton « Tester » des réglages. */
export function testNotification() {
  sendNotification({
    title: "PR Radar",
    body: "Les notifications fonctionnent.",
  })
}
