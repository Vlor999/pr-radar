import {
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleSlash,
  CircleX,
  Loader2,
  OctagonX,
  RotateCcw,
  type LucideIcon,
} from "lucide-react"
import { cn } from "cn"
import { useEffect, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { rerunFailed } from "@/lib/actions"
import { canRerun, formatDuration, jobDurationMs } from "@/lib/checks"
import { fetchChecks } from "@/lib/github"
import { strings, useStrings } from "@/lib/i18n"
import { DONE_ICON, DONE_MS, wait } from "@/lib/motion"
import { useData } from "@/lib/store"
import type { CiState, CiView, CiWorkflow, PrNode } from "@/lib/types"

const S = strings(
  {
    title: "CI",
    loading: "Chargement des jobs…",
    error: (msg: string) => `Jobs indisponibles : ${msg}`,
    empty: "Aucun job sur le dernier commit",
    statuses: "Statuts de commit",
    rerun: "Relancer les jobs en échec",
    rerunDone: "Jobs relancés",
    openJob: "Ouvrir le job sur GitHub",
    hiddenJobs: (n: number) =>
      `${n} job${n > 1 ? "s" : ""} non affiché${n > 1 ? "s" : ""}`,
    hiddenWorkflows: (n: number) =>
      `${n} workflow${n > 1 ? "s" : ""} non affiché${n > 1 ? "s" : ""}`,
    openChecks: "Ouvrir sur GitHub",
    state: {
      success: "Réussi",
      failure: "Échec",
      running: "En cours",
      queued: "En attente",
      skipped: "Ignoré",
      cancelled: "Annulé",
      neutral: "Neutre",
    } as Record<CiState, string>,
  },
  {
    title: "CI",
    loading: "Loading jobs…",
    error: (msg: string) => `Jobs unavailable: ${msg}`,
    empty: "No job on the last commit",
    statuses: "Commit statuses",
    rerun: "Re-run failed jobs",
    rerunDone: "Jobs re-run",
    openJob: "Open the job on GitHub",
    hiddenJobs: (n: number) => `${n} more job${n > 1 ? "s" : ""} not shown`,
    hiddenWorkflows: (n: number) =>
      `${n} more workflow${n > 1 ? "s" : ""} not shown`,
    openChecks: "Open on GitHub",
    state: {
      success: "Succeeded",
      failure: "Failed",
      running: "In progress",
      queued: "Queued",
      skipped: "Skipped",
      cancelled: "Cancelled",
      neutral: "Neutral",
    },
  },
)

/** durée affichée d'un job en cours, mise à jour chaque seconde */
const TICK_MS = 1000

const ICON: Record<CiState, { Icon: LucideIcon; className: string }> = {
  success: {
    Icon: CircleCheck,
    className: "text-green-600 dark:text-green-400",
  },
  failure: { Icon: CircleX, className: "text-destructive" },
  running: {
    Icon: Loader2,
    className:
      "animate-spin text-amber-600 motion-reduce:animate-none dark:text-amber-400",
  },
  queued: {
    Icon: CircleDashed,
    className: "text-amber-600 dark:text-amber-400",
  },
  skipped: { Icon: CircleSlash, className: "text-muted-foreground" },
  cancelled: { Icon: OctagonX, className: "text-muted-foreground" },
  neutral: { Icon: CircleMinus, className: "text-muted-foreground" },
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Suites ou jobs au-delà des bornes de la requête : leur nombre, et la page des checks de la PR sur GitHub. */
const Hidden = ({ text, url }: { text: string; url: string }) => {
  const t = useStrings(S)
  return (
    <p className="px-1 text-xs text-muted-foreground">
      {text} ·{" "}
      <a
        href={url}
        target="_blank"
        rel="noopener"
        className="text-primary hover:underline"
      >
        {t.openChecks}
      </a>
    </p>
  )
}

/** Vue CI d'une carte, ouverte depuis sa pastille CI : une boîte par workflow, une ligne par job. Montée seulement
 * vue ouverte (le panneau repliable démonte son contenu) : la requête part à l'ouverture, relue à chaque rechargement. */
export function CiGraph({ pr }: { pr: PrNode }) {
  const t = useStrings(S)
  const [view, setView] = useState<CiView>()
  const [error, setError] = useState("")
  const [now, setNow] = useState(Date.now)
  // chaque rechargement de la liste (actualisation auto ou manuelle, qui vide le cache) relit les jobs :
  // une CI en cours avance même si son état agrégé reste PENDING
  const { fetchedAt } = useData()

  useEffect(() => {
    let live = true
    fetchChecks(pr.repo, pr.number, pr.sha, pr.ci)
      .then((v) => {
        if (!live) return
        setView(v)
        setError("")
      })
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [pr.repo, pr.number, pr.sha, pr.ci, fetchedAt])

  const workflows = view?.workflows
  const checksUrl = `${pr.url}/checks`
  const running = !!workflows?.some((w) =>
    w.jobs.some((j) => j.state === "running"),
  )
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [running])

  return (
    <section aria-label={t.title} className="flex flex-col gap-2 border-t pt-3">
      {error && !view ? (
        <p className="text-xs text-destructive">{t.error(error)}</p>
      ) : !view ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          {t.loading}
        </p>
      ) : !view.workflows.length && !view.hiddenWorkflows ? (
        <p className="text-xs text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {view.workflows.map((w) => (
            // clé avec les états des jobs : une boîte relancée repart de zéro quand ses jobs changent
            <WorkflowBox
              key={`${w.key}:${w.jobs.map((j) => j.state).join()}`}
              pr={pr}
              w={w}
              now={now}
              checksUrl={checksUrl}
            />
          ))}
        </div>
      )}
      {!!view?.hiddenWorkflows && (
        <Hidden
          text={t.hiddenWorkflows(view.hiddenWorkflows)}
          url={checksUrl}
        />
      )}
    </section>
  )
}

function WorkflowBox({
  pr,
  w,
  now,
  checksUrl,
}: {
  pr: PrNode
  w: CiWorkflow
  now: number
  checksUrl: string
}) {
  const t = useStrings(S)
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  const rerun = () =>
    start(async () => {
      const res = await rerunFailed(pr.repo, w.runId!, async () => {
        setDone(true)
        await wait(DONE_MS)
      })
      // succès : la relecture de la liste qui suit (rerunFailed) relit aussi les jobs (`fetchedAt`)
      setError(res.error ?? "")
    })

  return (
    <div className="flex min-w-56 flex-1 flex-col gap-1 rounded-lg border bg-muted/30 p-2">
      <div className="flex flex-wrap items-baseline gap-x-2 px-1">
        <span className="truncate text-xs font-medium">
          {w.name ?? t.statuses}
          {w.file && w.file !== w.name && (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {w.file}
            </span>
          )}
        </span>
        {w.event && (
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            on: {w.event}
          </span>
        )}
      </div>
      <ul className="flex flex-col">
        {w.jobs.map((j, i) => {
          const { Icon, className } = ICON[j.state]
          const ms = jobDurationMs(j, now)
          const row = (
            <>
              {/* nom accessible de la ligne : état, nom, durée */}
              <Icon
                className={cn("size-3.5 shrink-0", className)}
                aria-hidden
              />
              <span className="sr-only">{t.state[j.state]},</span>
              <span className="min-w-0 flex-1 truncate">{j.name}</span>
              {ms !== null && (
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatDuration(ms)}
                </span>
              )}
            </>
          )
          const rowClass =
            "flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs"
          return (
            <li
              key={`${j.name}-${i}`}
              title={j.url ? undefined : t.state[j.state]}
            >
              {j.url ? (
                // liens https (filtrés par toCiView) ouverts dans le navigateur du système (routeLinksToBrowser, open.ts)
                <a
                  href={j.url}
                  target="_blank"
                  rel="noopener"
                  title={`${t.state[j.state]} · ${t.openJob}`}
                  className={cn(rowClass, "hover:bg-muted")}
                >
                  {row}
                </a>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          )
        })}
      </ul>
      {w.hiddenJobs > 0 && (
        <Hidden text={t.hiddenJobs(w.hiddenJobs)} url={checksUrl} />
      )}
      {(canRerun(w) || done) && (
        <Button
          variant="outline"
          size="xs"
          disabled={pending || done}
          onClick={rerun}
          className={cn("self-start", done && "disabled:opacity-100")}
        >
          {done ? (
            <CircleCheck className={DONE_ICON} />
          ) : pending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RotateCcw />
          )}
          {done ? t.rerunDone : t.rerun}
        </Button>
      )}
      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
