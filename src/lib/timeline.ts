/**
 * Vue Fil du calendrier : PR des repos suivis en lignes de temps. Logique pure (lecture GitHub → événements,
 * lignes de la fenêtre, placement des marqueurs), sans React ni réseau.
 */
// extensions : chargé aussi par node --test
import {
  TIMELINE_DRAFT_MIN_MS,
  TIMELINE_FADE_PX,
  TIMELINE_MARKER_GAP_PX,
  TIMELINE_MERGE_CLOSE_MS,
} from "./constants.ts"
import type { SlackMention, TimelineEvent, TimelinePr } from "./types.ts"

type Actor = { login: string; __typename?: string } | null

/** Nœud de `timelineItems` (types demandés par `TIMELINE_QUERY` de github.ts). */
export type RawTimelineItem =
  | {
      __typename: "PullRequestReview"
      author: Actor
      state: string
      submittedAt: string | null
      body: string
      comments: { totalCount: number }
    }
  | {
      __typename: "IssueComment"
      author: Actor
      createdAt: string
      body: string
    }
  | {
      __typename:
        "MergedEvent" | "ClosedEvent" | "ReopenedEvent" | "ReadyForReviewEvent"
      actor: Actor
      createdAt: string
    }

export type RawTimelinePr = {
  number: number
  title: string
  url: string
  state: "OPEN" | "MERGED" | "CLOSED"
  isDraft: boolean
  createdAt: string
  mergedAt: string | null
  closedAt: string | null
  author: Actor
  repository: { nameWithOwner: string }
  timelineItems: { nodes: (RawTimelineItem | null)[] }
}

/** Auteur robot (Renovate, Dependabot) : type `Bot` en GraphQL, ou login `…[bot]`. */
export const isBot = (a: Actor) =>
  !!a && (a.__typename === "Bot" || a.login.endsWith("[bot]"))

const byTime = (a: TimelineEvent, b: TimelineEvent) =>
  a.at.localeCompare(b.at) ||
  (a.kind === "start" ? -1 : b.kind === "start" ? 1 : 0)

/** PR lue sur GitHub → événements du fil. `repo` : clé du repo (avec le compte), `login` : moi sur ce compte. */
export function toTimelinePr(
  p: RawTimelinePr,
  repo: string,
  login: string,
): TimelinePr {
  const author = p.author?.login ?? "ghost"
  const events: TimelineEvent[] = [
    { kind: "start", at: p.createdAt, who: author },
  ]
  const mergedAt = p.mergedAt ? Date.parse(p.mergedAt) : null
  for (const n of p.timelineItems.nodes) {
    if (!n) continue
    switch (n.__typename) {
      case "PullRequestReview":
        if (n.state === "PENDING" || !n.submittedAt) break
        events.push({
          kind: "review",
          at: n.submittedAt,
          who: n.author?.login,
          text: n.body,
          review: n.state,
          threads: n.comments.totalCount,
        })
        break
      case "IssueComment":
        events.push({
          kind: "comment",
          at: n.createdAt,
          who: n.author?.login,
          text: n.body,
        })
        break
      case "MergedEvent":
        events.push({ kind: "merge", at: n.createdAt, who: n.actor?.login })
        break
      case "ClosedEvent":
        // la fermeture qui accompagne le merge
        if (
          mergedAt !== null &&
          Math.abs(Date.parse(n.createdAt) - mergedAt) < TIMELINE_MERGE_CLOSE_MS
        )
          break
        events.push({ kind: "close", at: n.createdAt, who: n.actor?.login })
        break
      case "ReopenedEvent":
        events.push({ kind: "reopen", at: n.createdAt, who: n.actor?.login })
        break
      case "ReadyForReviewEvent":
        events.push({ kind: "ready", at: n.createdAt, who: n.actor?.login })
        break
    }
  }
  // fin hors des événements lus (PR très active, `last` tronqué) : reprise des dates de la PR
  if (
    p.state === "MERGED" &&
    p.mergedAt &&
    !events.some((e) => e.kind === "merge")
  )
    events.push({ kind: "merge", at: p.mergedAt })
  if (
    p.state === "CLOSED" &&
    p.closedAt &&
    !events.some((e) => e.kind === "close")
  )
    events.push({ kind: "close", at: p.closedAt })
  return {
    repo,
    number: p.number,
    title: p.title,
    url: p.url,
    state: p.state,
    draft: p.isDraft,
    author,
    mine: author === login,
    createdAt: p.createdAt,
    events: events.sort(byTime),
  }
}

/** Ajoute au fil les messages Slack qui contiennent le lien de la PR. */
export const withSlack = (
  pr: TimelinePr,
  mentions: SlackMention[],
): TimelinePr =>
  mentions.length
    ? {
        ...pr,
        events: [
          ...pr.events,
          ...mentions.map((m): TimelineEvent => ({
            kind: "slack",
            at: m.at,
            who: m.author,
            text: m.text,
            where: m.where,
            permalink: m.permalink,
          })),
        ].sort(byTime),
      }
    : pr

/* ---------- Lignes de la fenêtre ---------- */

/** Fenêtre affichée, en ms : `start` (minuit du 1er jour), `end` (minuit après le dernier), `now`. */
export type TimelineWindow = { start: number; end: number; now: number }

export type TimelineStatus = "open" | "merged" | "closed"

export type TimelineRow = TimelinePr & {
  key: string
  t0: number
  /** fin (merge, fermeture) ; PR ouverte : maintenant */
  tEnd: number
  /** dernière activité : tri des PR ouvertes */
  last: number
  finished: boolean
  status: TimelineStatus
}

export const prKey = (p: { repo: string; number: number }) =>
  `${p.repo}#${p.number}`

/** Dernières `n` journées jusqu'à `last` (incluse), heure locale. */
export function windowOf(
  last: Date,
  days: number,
  now = Date.now(),
): TimelineWindow {
  const y = last.getFullYear()
  const m = last.getMonth()
  const d = last.getDate()
  return {
    start: new Date(y, m, d - days + 1).getTime(),
    end: new Date(y, m, d + 1).getTime(),
    now,
  }
}

/**
 * PR présentes sur la fenêtre (ouvertes avant sa fin, pas finies avant son début) : en cours d'abord,
 * puis terminées ; chaque groupe par fin (ou dernière activité) la plus récente.
 */
export function toRows(prs: TimelinePr[], w: TimelineWindow): TimelineRow[] {
  return prs
    .map((p): TimelineRow => {
      const t0 = Date.parse(p.createdAt)
      const end =
        p.state !== "OPEN"
          ? p.events
              .filter((e) => e.kind === "merge" || e.kind === "close")
              .at(-1)
          : undefined
      const last = Date.parse(p.events.at(-1)?.at ?? p.createdAt)
      return {
        ...p,
        key: prKey(p),
        t0,
        tEnd: end ? Date.parse(end.at) : w.now,
        last,
        finished: !!end,
        status: !end ? "open" : end.kind === "merge" ? "merged" : "closed",
      }
    })
    .filter((r) => r.t0 < w.end && r.tEnd >= w.start)
    .sort((a, b) =>
      a.finished !== b.finished
        ? a.finished
          ? 1
          : -1
        : (a.finished ? b.tEnd - a.tEnd : b.last - a.last) || b.t0 - a.t0,
    )
}

/* ---------- Placement ---------- */

export type TimelineSegment = {
  from: number
  to: number
  /** plein, brouillon (pointillés), fermée puis rouverte (pointillés rouges), fondu (ouverte avant la fenêtre) */
  kind: "solid" | "draft" | "gap" | "fade"
}

export type TimelineMarker = {
  x: number
  /** ouverture, merge ou fermeture (avec ce qu'ils absorbent), événement seul, groupe */
  type: "anchor" | "single" | "cluster"
  /** événement affiché (l'ancre, ou le seul de la liste) */
  lead: TimelineEvent
  /** événements listés dans l'info-bulle, par date */
  items: TimelineEvent[]
}

export type TimelineLayout = {
  segments: TimelineSegment[]
  markers: TimelineMarker[]
  /** PR ouverte : zone « pas encore mergée » sur la journée d'aujourd'hui */
  pending: { from: number; to: number } | null
}

/**
 * Fil d'une ligne sur `width` px. Marqueurs plus proches que `TIMELINE_MARKER_GAP_PX` : regroupés ; ceux qui
 * touchent l'ouverture ou la fin y sont absorbés (compteur). Ouverture et fin confondues (PR du jour) :
 * l'ouverture recule pour garder un bout de fil.
 */
export function layoutRow(
  r: TimelineRow,
  w: TimelineWindow,
  width: number,
): TimelineLayout {
  const GAP = TIMELINE_MARKER_GAP_PX
  const x = (t: number) => ((t - w.start) / (w.end - w.start)) * width
  const at = (e: TimelineEvent) => x(Date.parse(e.at))
  const day = new Date(w.now)
  const todayX = x(
    new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(),
  )
  const x0 = Math.max(x(r.t0), 0)
  const x1 = Math.min(x(r.tEnd), width)
  const stop = r.finished ? width : Math.min(todayX, width)

  const endEvent = r.finished
    ? r.events.filter((e) => e.kind === "merge" || e.kind === "close").at(-1)
    : undefined
  const pts = r.events.filter(
    (e) => e.kind !== "ready" && at(e) >= 0 && at(e) <= width,
  )
  const fixed = pts.filter((e) => e.kind === "start" || e === endEvent)
  const free = pts.filter((e) => !fixed.includes(e))

  const clusters: { x0: number; x: number; items: TimelineEvent[] }[] = []
  for (const e of free) {
    const xe = at(e)
    const c = clusters.at(-1)
    if (c && xe - c.x < GAP) {
      c.items.push(e)
      c.x = (c.x0 + xe) / 2
    } else clusters.push({ x0: xe, x: xe, items: [e] })
  }

  const anchors = fixed.map((e) => ({ e, x: at(e), items: [e] }))
  if (anchors.length > 1 && anchors[1].x - anchors[0].x < GAP) {
    anchors[0].x = Math.max(anchors[1].x - GAP, 0)
    anchors[1].x = Math.max(anchors[1].x, anchors[0].x + GAP)
  }
  for (let i = clusters.length - 1; i >= 0; i--) {
    const c = clusters[i]
    let near: (typeof anchors)[number] | null = null
    for (const a of anchors)
      if (
        Math.abs(a.x - c.x) < GAP &&
        (!near || Math.abs(a.x - c.x) < Math.abs(near.x - c.x))
      )
        near = a
    if (near) {
      near.items.push(...c.items)
      clusters.splice(i, 1)
    }
  }
  for (const a of anchors) a.items.sort(byTime)

  const segments: TimelineSegment[] = []
  if (x(r.t0) < 0 && x1 > 0)
    segments.push({ from: 0, to: Math.min(TIMELINE_FADE_PX, x1), kind: "fade" })
  const lineFrom = Math.min(x0, ...anchors.map((a) => a.x))
  const lineTo = Math.max(
    r.finished ? x1 : Math.min(x1, todayX),
    ...anchors.slice(1).map((a) => a.x),
  )
  if (lineTo > lineFrom)
    segments.push({ from: lineFrom, to: lineTo, kind: "solid" })
  const cut = (from: number, to: number, kind: "draft" | "gap") => {
    const a = Math.max(x(from), 0)
    const b = Math.min(x(to), stop)
    if (b > a) segments.push({ from: a, to: b, kind })
  }
  const ready = r.events.find((e) => e.kind === "ready")
  if (r.draft && !ready) cut(r.t0, r.tEnd, "draft")
  else if (ready && Date.parse(ready.at) - r.t0 > TIMELINE_DRAFT_MIN_MS)
    cut(r.t0, Date.parse(ready.at), "draft")
  r.events.forEach((e, i) => {
    if (e.kind !== "close") return
    const back = r.events.slice(i).find((z) => z.kind === "reopen")
    if (back) cut(Date.parse(e.at), Date.parse(back.at), "gap")
  })

  const pending =
    !r.finished && todayX < width
      ? { from: Math.max(todayX, x0 - GAP / 2) + 2, to: width - 2 }
      : null

  return {
    segments,
    pending,
    markers: [
      ...anchors.map((a): TimelineMarker => ({
        x: a.x,
        type: "anchor",
        lead: a.e,
        items: a.items,
      })),
      ...clusters.map((c): TimelineMarker => ({
        x: c.x,
        type: c.items.length > 1 ? "cluster" : "single",
        lead: c.items[0],
        items: c.items,
      })),
    ],
  }
}
