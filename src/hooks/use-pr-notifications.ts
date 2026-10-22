import { invoke } from "@tauri-apps/api/core"
import { useEffect, useRef, useSyncExternalStore } from "react"

import { pick, strings } from "@/lib/i18n"
import { newRequests, reviewKey, snapshot, type Reviews } from "@/lib/review"
import { getSettings, shouldNotify, type Settings } from "@/lib/settings"
import type { Pr } from "@/lib/types"

const S = strings(
  {
    approved: "approuvée",
    changesRequested: "changements demandés",
    comments: (n: number) =>
      `${n} nouveau${n > 1 ? "x" : ""} commentaire${n > 1 ? "s" : ""}`,
    ciFailed: "CI en échec",
    testBody: "Les notifications fonctionnent.",
    title: (key: string, text: string) => `${key} : ${text}`,
    reviewRequested: (who: string) => `${who} demande ta review`,
    rerequested: (who: string) => `${who} redemande ta review`,
  },
  {
    approved: "approved",
    changesRequested: "changes requested",
    comments: (n: number) => `${n} new comment${n > 1 ? "s" : ""}`,
    ciFailed: "CI failed",
    testBody: "Notifications are working.",
    title: (key: string, text: string) => `${key}: ${text}`,
    reviewRequested: (who: string) => `${who} requests your review`,
    rerequested: (who: string) => `${who} re-requests your review`,
  },
)

/* ---------- Envoi : on appelle la commande du plugin pour récupérer les erreurs ---------- */

type Sent = { title: string; at: string }
const LAST = "pr-radar:last-notification"
const listeners = new Set<() => void>()
const readLast = () => {
  try {
    return localStorage.getItem(LAST)
  } catch {
    return null
  }
}

/** Envoie une notification système ; rejette avec l'erreur du système si elle échoue. */
export async function notify(title: string, body: string) {
  await invoke("plugin:notification|notify", { options: { title, body } })
  try {
    localStorage.setItem(
      LAST,
      JSON.stringify({ title, at: new Date().toISOString() }),
    )
  } catch {}
  listeners.forEach((l) => l())
}

/** Dernière notification envoyée par l'app (réglages : preuve que le mécanisme tourne). */
export function useLastNotification(): Sent | null {
  const raw = useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, readLast)
  return raw ? (JSON.parse(raw) as Sent) : null
}

type Kind = keyof Settings["notify"]

/** Ce qui a changé sur une PR depuis le dernier chargement : type (réglable) et phrase, ou null. */
function change(before: Pr, now: Pr): { kind: Kind; text: string } | null {
  const t = pick(S)
  if (now.decision !== before.decision && now.decision === "APPROVED")
    return { kind: "approved", text: t.approved }
  if (now.decision !== before.decision && now.decision === "CHANGES_REQUESTED")
    return { kind: "changesRequested", text: t.changesRequested }
  if (now.comments > before.comments) {
    const n = now.comments - before.comments
    return {
      kind: "comments",
      text: t.comments(n),
    }
  }
  if (now.ci !== before.ci && (now.ci === "FAILURE" || now.ci === "ERROR"))
    return { kind: "ciFailed", text: t.ciFailed }
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
      return what && shouldNotify(getSettings(), now, what.kind)
        ? [{ key, now, what }]
        : []
    })
    for (const { key, now, what } of changes)
      notify(pick(S).title(key, what.text), now.title).catch(() => {})
  }, [prs])
}

/** Notification d'une nouvelle demande de review nominative (ou re-request), entre deux rafraîchissements. */
export function useReviewNotifications(known: Reviews) {
  const previous = useRef<ReturnType<typeof snapshot> | null>(null)

  useEffect(() => {
    const before = previous.current
    previous.current = snapshot(known)
    if (!before) return
    const t = pick(S)
    for (const p of newRequests(before, known.reviews).filter((p) =>
      shouldNotify(getSettings(), p, "reviewRequested"),
    ))
      notify(
        t.title(
          reviewKey(p),
          (p.rerequest ? t.rerequested : t.reviewRequested)(p.author),
        ),
        p.title,
      ).catch(() => {})
  }, [known])
}

/** Bouton « Envoyer une notification de test » des réglages. */
export function testNotification() {
  return notify("PR Radar", pick(S).testBody)
}
