import { useState, useTransition, type ReactNode } from "react"
import { ExternalLink, Loader2, Send } from "lucide-react"
import { cn } from "cn"

import { Avatar } from "@/components/avatar"
import { comment, reply } from "@/lib/actions"
import { strings, useStrings } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { Note, Thread } from "@/lib/types"

/** initiales affichées dans l'en-tête d'une discussion, au-delà : un « +N » */
const MAX_INITIALS = 3

const S = strings(
  {
    conversation: "Conversation",
    review: {
      APPROVED: "Approuvée",
      CHANGES_REQUESTED: "Changements demandés",
      COMMENTED: "Commentée",
      DISMISSED: "Rejetée",
    } as Record<string, string>,
    agoNow: "à l'instant",
    agoH: (h: number) => `il y a ${h} h`,
    agoD: (d: number) => `il y a ${d} j`,
    outdated: "code modifié depuis",
    reply: "Répondre",
    replyPlaceholder: "Répondre…",
    viewOnGithub: "Voir sur GitHub",
  },
  {
    conversation: "Conversation",
    review: {
      APPROVED: "Approved",
      CHANGES_REQUESTED: "Changes requested",
      COMMENTED: "Commented",
      DISMISSED: "Dismissed",
    } as Record<string, string>,
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

/** Colonne des discussions ouvertes d'une PR, reliée à sa carte par des traits (affichée sous la carte) :
 * d'abord les commentaires généraux, puis les fils non résolus. */
export function ThreadColumn({
  prId,
  threads,
  conversation,
  repo,
}: {
  prId: string
  threads: Thread[]
  conversation: Note[]
  repo: string
}) {
  return (
    <ul className="flex min-w-0 animate-in flex-col gap-3 pl-14 duration-200 fade-in slide-in-from-top-2 motion-reduce:animate-none">
      {conversation.length > 0 && (
        <Bubble>
          <ConversationCard notes={conversation} prId={prId} repo={repo} />
        </Bubble>
      )}
      {threads.map((t) => (
        <Bubble key={t.id}>
          <ThreadCard thread={t} repo={repo} />
        </Bubble>
      ))}
    </ul>
  )
}

function Bubble({ children }: { children: ReactNode }) {
  return (
    <li
      className={cn(
        "relative",
        // coude qui part de la carte de la PR vers chaque discussion.
        // Valeurs liées : -top-3 = gap-3 sous la carte (repo-section) ; -left-4.5 sous pl-14 ;
        // trait du coude à y = 15px (-top-3 + h-7), pointe de la queue au même y (top-2.25 + 6px).
        "before:absolute before:-top-3 before:-left-4.5 before:h-7 before:w-3 before:rounded-bl-lg before:border-b-2 before:border-l-2 before:border-border",
        "not-last:after:absolute not-last:after:top-0 not-last:after:-bottom-3 not-last:after:-left-4.5 not-last:after:border-l-2 not-last:after:border-border",
      )}
    >
      {/* queue de la bulle : pointe sur le trait du coude (y = 15px), même trait que le coude */}
      <span
        aria-hidden
        className="absolute top-2.25 -left-1.5 z-10 size-3 rotate-45 border-b-2 border-l-2 border-border bg-card"
      />
      {children}
    </li>
  )
}

function ThreadCard({ thread, repo }: { thread: Thread; repo: string }) {
  const t = useStrings(S)
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
        <Participants notes={thread.comments} />
      </header>

      {thread.hunk && <Hunk hunk={thread.hunk} />}

      <Messages notes={thread.comments} />

      <ReplyForm
        id={thread.id}
        link={thread.comments.at(-1)?.url}
        onSend={(text) => reply(thread.id, text, repo)}
      />
    </Card>
  )
}

/** Commentaires généraux et textes de review ; la réponse est un nouveau commentaire général sur la PR. */
function ConversationCard({
  notes,
  prId,
  repo,
}: {
  notes: Note[]
  prId: string
  repo: string
}) {
  const t = useStrings(S)
  return (
    <Card
      size="sm"
      className="gap-0 rounded-2xl rounded-tl-md py-0 shadow-sm ring-foreground/10"
    >
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <h3 className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">
          {t.conversation}
        </h3>
        <Participants notes={notes} />
      </header>
      <Messages notes={notes} />
      <ReplyForm
        id={prId}
        link={notes.at(-1)?.url}
        onSend={(text) => comment(prId, text, repo)}
      />
    </Card>
  )
}

/** Zone de réponse en bas d'une carte : ⌘↵ envoie, vidée après succès. */
function ReplyForm({
  id,
  link,
  onSend,
}: {
  id: string
  link?: string
  onSend: (text: string) => Promise<{ error?: string }>
}) {
  const t = useStrings(S)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState("")
  const [sending, start] = useTransition()

  const send = () =>
    start(async () => {
      const res = await onSend(draft)
      setError(res.error ?? "")
      if (!res.error) setDraft("")
    })

  return (
    <form
      className="flex flex-col gap-2 border-t px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <label htmlFor={`reply-${id}`} className="sr-only">
        {t.reply}
      </label>
      <textarea
        id={`reply-${id}`}
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
          href={link}
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
  )
}

/** participants : décoratif, les auteurs sont lus dans la liste des commentaires */
function Participants({ notes }: { notes: Note[] }) {
  const authors = [...new Set(notes.map((c) => c.author))]
  const extra = authors.length - MAX_INITIALS
  const url = notes[0]?.url
  return (
    <span aria-hidden className="flex shrink-0 -space-x-1.5">
      {authors.slice(0, MAX_INITIALS).map((a) => (
        <Avatar key={a} login={a} url={url} />
      ))}
      {extra > 0 && (
        <span
          title={authors.slice(MAX_INITIALS).join(", ")}
          className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-card"
        >
          +{extra}
        </span>
      )}
    </span>
  )
}

function Messages({ notes }: { notes: Note[] }) {
  const t = useStrings(S)
  return (
    <ol className="flex flex-col text-sm">
      {notes.map((c) => (
        <li key={c.url} className="flex gap-2.5 px-4 py-3 even:bg-muted/50">
          <Avatar login={c.author} url={c.url} className="size-7" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
              {c.state && (
                <span className="text-xs text-muted-foreground">
                  · {t.review[c.state] ?? c.state}
                </span>
              )}
            </div>
            <p className="break-words whitespace-pre-line">{c.body}</p>
          </div>
        </li>
      ))}
    </ol>
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
