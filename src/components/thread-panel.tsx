import { useState, useTransition } from "react"
import { ExternalLink, Loader2, Send } from "lucide-react"
import { cn } from "cn"

import { reply } from "@/lib/actions"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { Thread } from "@/lib/types"

function ago(iso: string) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000)
  return h >= 48
    ? `il y a ${Math.floor(h / 24)} j`
    : h
      ? `il y a ${h} h`
      : "à l'instant"
}

/** Colonne des discussions ouvertes d'une PR, reliée à sa carte par des traits (affichée sous la carte). */
export function ThreadColumn({ threads }: { threads: Thread[] }) {
  return (
    <ul className="flex min-w-0 animate-in flex-col gap-3 pl-6 duration-200 fade-in slide-in-from-top-2 motion-reduce:animate-none">
      {threads.map((t) => (
        <li
          key={t.id}
          className={cn(
            "relative",
            // coude qui part de la carte de la PR vers chaque discussion
            "before:absolute before:top-0 before:-left-5 before:h-7 before:w-5 before:rounded-bl-lg before:border-b-2 before:border-l-2 before:border-border",
            "not-last:after:absolute not-last:after:top-0 not-last:after:-bottom-3 not-last:after:-left-5 not-last:after:border-l-2 not-last:after:border-border",
          )}
        >
          <ThreadCard thread={t} />
        </li>
      ))}
    </ul>
  )
}

function ThreadCard({ thread }: { thread: Thread }) {
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
    <Card size="sm" className="gap-0 rounded-2xl py-0">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <a
          href={thread.comments[0]?.url}
          target="_blank"
          rel="noopener"
          className="min-w-0 truncate font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
          title={thread.path}
        >
          {thread.path}
          {thread.line ? `:${thread.line}` : ""}
        </a>
        {thread.outdated && (
          <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
            code modifié depuis
          </span>
        )}
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
                {ago(c.at)}
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
          Répondre
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
          placeholder="Répondre…"
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
            Voir sur GitHub <ExternalLink className="size-3" />
          </a>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">⌘↵</span>
            <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              Répondre
            </Button>
          </div>
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
