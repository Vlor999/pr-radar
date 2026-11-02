import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { splitKey } from "@/lib/accounts"
import { findAccount } from "@/lib/auth"
import { fetchDmReviewers } from "@/lib/github"
import {
  addDismissed,
  dismissKey,
  dmNames,
  dmRecipients,
  ghostReviewers,
  parseDismissed,
  unresolvedRecipients,
  type PendingReview,
  type Reviewer,
} from "@/lib/reviewers"
import { useMentions, useSlack } from "@/lib/slack"
import {
  dmReviewers,
  lookupRecipients,
  useSlackGithubMap,
} from "@/lib/slack-github-map"
import { onPulled, saveItem } from "@/lib/sync"
import type { Pr } from "@/lib/types"

/* ---------- Suggestions écartées (croix du reviewer fantôme), gardées dans le navigateur ---------- */

const KEY = "pr-radar:dm-dismissed"
/** au-delà, les plus anciennes sont oubliées (PR fermées depuis longtemps) */
const DISMISSED_MAX = 200

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

onPulled((keys) => {
  if (keys.includes(KEY)) emit()
})

/** Écarte la suggestion de `login` sur cette PR : elle ne revient pas, même après un rechargement. */
export function dismissDmSuggestion(url: string, login: string) {
  saveItem(
    KEY,
    JSON.stringify(
      addDismissed(
        parseDismissed(read()),
        dismissKey(url, login),
        DISMISSED_MAX,
      ),
    ),
  )
  emit()
}

/* ---------- Reviewer fantôme d'une carte ---------- */

/**
 * Destinataires de mes DM Slack 1:1 sur une de mes PR, rapprochés d'un utilisateur GitHub et pas encore
 * reviewers. Liens de la table Slack → GitHub des réglages d'abord (sans requête), sinon rapprochement par nom.
 * Requête GitHub seulement s'il reste un destinataire sans login connu (en cache 10 min, voir
 * `fetchDmReviewers`) ; PR d'un autre ou sans DM : aucune.
 */
export function useDmSuggestions(pr: Pr, pending: PendingReview[]): Reviewer[] {
  const mentions = useMentions(pr.url)
  const raw = useSyncExternalStore(subscribe, read)
  const dismissed = useMemo(() => parseDismissed(raw), [raw])
  const [found, setFound] = useState<{ key: string; users: Reviewer[] }>()
  const map = useSlackGithubMap()
  const team = useSlack().team?.id
  const account = splitKey(pr.repo).account

  const recipients = pr.involved ? [] : dmRecipients(mentions)
  const known = [
    ...pr.reviews.map((r) => r.who),
    ...pr.requested.filter((r) => !r.team).map((r) => r.who),
    ...pending.map((p) => p.login),
  ]
  // chaîne : clé stable de l'effet (les tableaux changent d'identité à chaque rendu)
  const names = dmNames(
    unresolvedRecipients(
      lookupRecipients(recipients, map, team, account),
      known,
    ),
  ).join("\n")

  useEffect(() => {
    if (!names) return
    let live = true
    fetchDmReviewers(pr.repo, names.split("\n")).then(
      (users) => live && setFound({ key: names, users }),
      () => {}, // suggestion au mieux : un échec n'affiche simplement rien
    )
    return () => {
      live = false
    }
  }, [pr.repo, names])

  const users = names && found?.key === names ? found.users : []
  return ghostReviewers(
    dmReviewers(recipients, map, team, account, users),
    pr,
    pending,
    dismissed,
    findAccount(account)?.login,
  )
}
