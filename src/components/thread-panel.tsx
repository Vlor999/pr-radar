import { useState, useTransition } from "react"
import { ExternalLink, Loader2, Send } from "lucide-react"
import { cn } from "cn"

import { reply } from "@/lib/actions"
import { strings, useStrings } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { Thread } from "@/lib/types"

const S = strings(
  {
    agoNow: "à l'instant",
    agoH: (h: number) => `il y a ${h} h`,
    agoD: (d: number) => `il y a ${d} j`,
    outdated: "code modifié depuis",
    reply: "Répondre",
    replyPlaceholder: "Répondre…",
    viewOnGithub: "Voir sur GitHub",
  },
  {
    agoNow: "just now",
    agoH: (h: number) => `${h}h ago`,
    agoD: (d: number) => `${d}d ago`,
    outdated: "code changed since",
    reply: "Reply",
    replyPlaceholder: "Reply…",
    viewOnGithub: "View on GitHub",
  },
)

function ago(iso: string, t: typeof S.fr) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000)
  return h >= 48 ? t.agoD(Math.floor(h / 24)) : h ? t.agoH(h) : t.agoNow
}

/** Colonne des discussions ouvertes d'une PR, reliée à sa carte par des traits (affichée sous la carte). */
export function ThreadColumn({ threads }: { threads: Thread[] }) {
  return (
    <ul className="flex min-w-0 animate-in flex-col gap-3 pl-14 duration-200 fade-in slide-in-from-top-2 motion-reduce:animate-none">
      {threads.map((t) => (
        <li
          key={t.id}
          className={cn(
            "relative",
            // short rail hanging from the PR card; the elbow line (y=15px) runs under the bubble tail
            "before:absolute before:-top-3 before:-left-4.5 before:h-7 before:w-3 before:rounded-bl-lg before:border-b-2 before:border-l-2 before:border-border",
            "not-last:after:absolute not-last:after:top-0 not-last:after:-bottom-3 not-last:after:-left-4.5 not-last:after:border-l-2 not-last:after:border-border",
          )}
        >
          {/* bubble tail: tip at the elbow line (y=15px), same stroke as the elbow */}
          <span className="absolute top-[9px] -left-1.5 z-10 size-3 rotate-45 border-b-2 border-l-2 border-border bg-card" />
          <ThreadCard thread={t} />
        </li>
      ))}
    </ul>
  )
}

function ThreadCard({ thread }: { thread: Thread }) {
  const t = useStrings(S)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState("")
  const [sending, start] = useTransition()

  const send = () =>
    start(async () => {
      const res = await reply(thread.id, draft)
      setError(res.error ?? "")
      if (!res.error) setDraft("")
    })

  return (
    <Card
      size="sm"
      className="gap-0 rounded-2xl rounded-tl-md py-0 shadow-sm ring-foreground/10"
    >
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <a
          href={thread.comments[0]?.url}
          target="_blank"
          rel="noopener"
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
          title={thread.path}
        >
          {thread.path}
          {thread.line ? `:${thread.line}` : ""}
        </a>
        {thread.outdated && (
          <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
            {t.outdated}
          </span>
        )}
        <span className="flex shrink-0 -space-x-1.5">
          {[...new Set(thread.comments.map((c) => c.author))].map((a) => (
            <span
              key={a}
              title={a}
              className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-medium uppercase ring-2 ring-card"
            >
              {a[0]}
            </span>
          ))}
        </span>
      </header>

      {thread.hunk && <Hunk hunk={thread.hunk} />}

      <ol className="flex flex-col gap-3 px-4 py-3 text-sm">
        {thread.comments.map((c) => (
          <li key={c.url} className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{c.author}</span>
              <a
                href={c.url}
                target="_blank"
                rel="noopener"
                className="text-xs text-muted-foreground hover:underline"
              >
                {ago(c.at, t)}
              </a>
            </div>
            <p className="break-words whitespace-pre-line">{c.body}</p>
          </li>
        ))}
      </ol>

      <form
        className="flex flex-col gap-2 border-t px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <label htmlFor={`reply-${thread.id}`} className="sr-only">
          {t.reply}
        </label>
        <textarea
          id={`reply-${thread.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
          placeholder={t.replyPlaceholder}
          disabled={sending}
          className="min-h-16 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <a
            href={thread.comments.at(-1)?.url}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            {t.viewOnGithub} <ExternalLink className="size-3" />
          </a>
          <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            {t.reply}
            <kbd className="font-sans text-xs opacity-70">⌘↵</kbd>
          </Button>
        </div>
      </form>
    </Card>
  )
}

/** Extrait du diff, coloré comme sur GitHub. */
function Hunk({ hunk }: { hunk: string }) {
  return (
    <pre className="border-b bg-muted/40 py-2 font-mono text-xs leading-5">
      {hunk.split("\n").map((line, i) => (
        <div
          key={i}
          className={cn(
            // lignes longues : retour à la ligne, la suite décalée sous le texte (après le +/-)
            "pr-4 pl-[calc(1rem+1ch)] -indent-[1ch] break-words whitespace-pre-wrap",
            line.startsWith("+") &&
              "bg-green-500/10 text-green-800 dark:text-green-300",
            line.startsWith("-") &&
              "bg-red-500/10 text-red-800 dark:text-red-300",
            line.startsWith("@@") && "text-muted-foreground",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  )
}
