import { cn } from "cn"
import { ArrowLeft, Check, ChevronRight, Copy, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Row, Section, Segmented, Toggle } from "@/components/settings-ui"
import { Button } from "@/components/ui/button"
import { locale, strings, useStrings } from "@/lib/i18n"
import {
  clearMcpHistory,
  setMcpEnabled,
  useMcp,
  useMcpHistory,
} from "@/lib/mcp"
import { callsToday, installSnippet, type McpClient } from "@/lib/mcp-data"
import type { McpCall } from "@/lib/types"

/** durée de la coche « Copié » */
const COPIED_MS = 1_500

const S = strings(
  {
    back: "Retour",
    title: "Serveur MCP",
    subtitle:
      "Un agent local (Claude Code, Claude Desktop…) lit tes PR et leurs mentions Slack, déjà chargées par PR Radar. Lecture seule, rien ne sort de ta machine.",
    state: {
      title: "État",
      description:
        "Désactivé par défaut. Activé, PR Radar ouvre un socket local accessible à ton seul compte.",
      server: "Serveur MCP",
      on: "Actif : les agents branchés peuvent lire tes PR.",
      off: "Inactif : aucun socket ouvert.",
      error: (e: string) => `Erreur : ${e}`,
      today: "Appels aujourd'hui",
      socket: "Socket",
    },
    install: {
      title: "Installation",
      description:
        "Branche ton agent sur PR Radar. L'app doit tourner, serveur activé.",
      client: "Agent",
      other: "Autre",
      hint: {
        "claude-code": "Dans un terminal, une seule fois :",
        "claude-desktop":
          "Dans claude_desktop_config.json (Réglages › Développeur › Modifier la config), puis redémarre Claude Desktop :",
        other: "Commande stdio à déclarer dans ton client MCP :",
      } satisfies Record<McpClient, string>,
      copy: "Copier",
      copied: "Copié",
    },
    tools: {
      title: "Outils exposés",
      description:
        "Lecture seule : aucun outil n'écrit sur GitHub ni Slack. Les données sont celles affichées, sans requête supplémentaire.",
      getPrs:
        "Mes PR ouvertes (CI, décision, conflits, reviewers, taille, fils non résolus, stack, mentions Slack), celles des autres où je suis assigné, mentionné ou impliqué (champ `involved`) et l'onglet « À reviewer ».",
      getPr:
        "Une PR de l'arbre (à moi ou qui me concerne) : fils de review non résolus et conversation, en texte.",
    },
    history: {
      title: "Historique",
      description:
        "Les 50 derniers appels, gardés sur cette machine. Jamais le contenu des réponses.",
      empty: "Aucun appel pour l'instant.",
      clear: "Effacer",
      ok: "Réussi",
      failed: "Échec",
      details: "Détails",
      args: "Arguments",
      size: "Taille de la réponse",
      error: "Erreur",
    },
  },
  {
    back: "Back",
    title: "MCP server",
    subtitle:
      "A local agent (Claude Code, Claude Desktop…) reads your PRs and their Slack mentions, already loaded by PR Radar. Read-only, nothing leaves your machine.",
    state: {
      title: "Status",
      description:
        "Off by default. When on, PR Radar opens a local socket only your user account can reach.",
      server: "MCP server",
      on: "On: connected agents can read your PRs.",
      off: "Off: no socket open.",
      error: (e: string) => `Error: ${e}`,
      today: "Calls today",
      socket: "Socket",
    },
    install: {
      title: "Setup",
      description:
        "Connect your agent to PR Radar. The app must be running, server on.",
      client: "Agent",
      other: "Other",
      hint: {
        "claude-code": "In a terminal, once:",
        "claude-desktop":
          "In claude_desktop_config.json (Settings › Developer › Edit Config), then restart Claude Desktop:",
        other: "Stdio command to declare in your MCP client:",
      },
      copy: "Copy",
      copied: "Copied",
    },
    tools: {
      title: "Exposed tools",
      description:
        "Read-only: no tool writes to GitHub or Slack. Data is what the app shows, with no extra request.",
      getPrs:
        "My open PRs (CI, decision, conflicts, reviewers, size, unresolved threads, stack, Slack mentions), other people's PRs where I am assigned, mentioned or involved (`involved` field), and the “To review” tab.",
      getPr:
        "One PR of the tree (mine or one involving me): unresolved review threads and conversation, as text.",
    },
    history: {
      title: "History",
      description:
        "The last 50 calls, kept on this machine. Never the content of the replies.",
      empty: "No calls yet.",
      clear: "Clear",
      ok: "Succeeded",
      failed: "Failed",
      details: "Details",
      args: "Arguments",
      size: "Reply size",
      error: "Error",
    },
  },
)

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : `${(bytes / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 })} kB`

/** Heure de l'appel ; un autre jour : date et heure. */
const when = (at: string) => {
  const d = new Date(at)
  const time: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(locale(), time)
    : d.toLocaleString(locale(), { day: "numeric", month: "short", ...time })
}

function StateSection() {
  const t = useStrings(S).state
  const { info, running, error } = useMcp()
  const history = useMcpHistory()
  return (
    <Section id="mcp-state" title={t.title} description={t.description}>
      <Row
        labelId="mcp-toggle"
        label={t.server}
        description={
          error ? (
            <span className="text-destructive">{t.error(error)}</span>
          ) : running ? (
            t.on
          ) : (
            t.off
          )
        }
      >
        <Toggle
          checked={running}
          onChange={(v) => void setMcpEnabled(v)}
          labelledBy="mcp-toggle"
        />
      </Row>
      <Row label={t.today}>
        <span className="text-sm tabular-nums">
          {callsToday(history, new Date())}
        </span>
      </Row>
      {info?.socket && (
        <Row
          label={t.socket}
          description={
            <span className="font-mono break-all">{info.socket}</span>
          }
        />
      )}
    </Section>
  )
}

function InstallSection() {
  const t = useStrings(S).install
  const { info } = useMcp()
  const [client, setClient] = useState<McpClient>("claude-code")
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!info) return null
  const snippet = installSnippet(client, info.exe)
  const copy = () =>
    navigator.clipboard.writeText(snippet).then(
      () => {
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
      },
      () => {},
    )
  return (
    <Section id="mcp-install" title={t.title} description={t.description}>
      <Row labelId="mcp-client" label={t.client}>
        <Segmented
          value={client}
          onChange={setClient}
          labelledBy="mcp-client"
          options={[
            { value: "claude-code", label: "Claude Code" },
            { value: "claude-desktop", label: "Claude Desktop" },
            { value: "other", label: t.other },
          ]}
        />
      </Row>
      <div className="border-t py-3">
        <p className="text-xs text-muted-foreground">{t.hint[client]}</p>
        <div className="mt-2 flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs">
            {snippet}
          </pre>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={copy}
            aria-label={copied ? t.copied : t.copy}
            title={copied ? t.copied : t.copy}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      </div>
    </Section>
  )
}

function ToolsSection() {
  const t = useStrings(S).tools
  return (
    <Section id="mcp-tools" title={t.title} description={t.description}>
      <Row
        label={<code className="font-mono">get_prs</code>}
        description={t.getPrs}
      />
      <Row
        label={<code className="font-mono">get_pr(url)</code>}
        description={t.getPr}
      />
    </Section>
  )
}

function HistoryRow({ call }: { call: McpCall }) {
  const t = useStrings(S).history
  const [open, setOpen] = useState(false)
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t.details}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 py-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        {call.ok ? (
          <Check
            aria-label={t.ok}
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
        ) : (
          <X
            aria-label={t.failed}
            className="size-4 shrink-0 text-destructive"
          />
        )}
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {when(call.at)}
        </span>
        <span className="min-w-0 truncate">{call.client}</span>
        <code className="shrink-0 font-mono text-xs">{call.tool}</code>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {call.ms} ms
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <dl className="mb-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg bg-muted p-3 text-xs">
          <dt className="text-muted-foreground">{t.args}</dt>
          <dd className="font-mono break-all">{JSON.stringify(call.args)}</dd>
          <dt className="text-muted-foreground">{t.size}</dt>
          <dd className="tabular-nums">{size(call.bytes)}</dd>
          {call.error && (
            <>
              <dt className="text-muted-foreground">{t.error}</dt>
              <dd className="break-words text-destructive">{call.error}</dd>
            </>
          )}
        </dl>
      )}
    </li>
  )
}

function HistorySection() {
  const t = useStrings(S).history
  const history = useMcpHistory()
  return (
    <Section id="mcp-history" title={t.title} description={t.description}>
      {history.length ? (
        <>
          <ul>
            {history.map((c, i) => (
              <HistoryRow key={`${c.at}-${i}`} call={c} />
            ))}
          </ul>
          <div className="flex justify-end border-t py-3">
            <Button variant="outline" size="sm" onClick={clearMcpHistory}>
              <Trash2 data-icon="inline-start" />
              {t.clear}
            </Button>
          </div>
        </>
      ) : (
        <p className="py-3 text-sm text-muted-foreground">{t.empty}</p>
      )}
    </Section>
  )
}

export function McpPage({ onClose }: { onClose: () => void }) {
  const t = useStrings(S)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-4 pb-16 md:px-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onClose} className="-ml-2">
          <ArrowLeft data-icon="inline-start" />
          {t.back}
        </Button>
        <h1 className="mt-2 font-heading text-xl font-semibold tracking-tight">
          {t.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
      </div>
      <StateSection />
      <InstallSection />
      <ToolsSection />
      <HistorySection />
    </div>
  )
}
