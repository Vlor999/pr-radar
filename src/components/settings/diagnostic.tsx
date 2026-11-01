import { cn } from "cn"
import { Copy, Download, FolderOpen, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { words, type SettingsEntry } from "@/components/settings/category"
import {
  Feedback,
  Row,
  Section,
  Segmented,
  Toggle,
  useFlash,
} from "@/components/settings/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  LOG_CUSTOM_DAYS_MAX,
  LOG_CUSTOM_DAYS_MIN,
  LOG_VIEW_LIMIT,
} from "@/lib/constants"
import { locale, strings, useStrings, type Lang } from "@/lib/i18n"
import {
  exportLog,
  pickLogDir,
  purgeLog,
  readLog,
  resolveLogDir,
  revealLogDir,
} from "@/lib/log"
import { toJsonl } from "@/lib/log-data"
import {
  logDaysOf,
  updateSettings,
  useSettings,
  type LogRetention,
} from "@/lib/settings"
import type { LogDir, LogEntry, LogLevel } from "@/lib/types"

const S = strings(
  {
    subtitle:
      "Journal d'activité gardé sur cette machine uniquement : actualisations, erreurs GitHub et Slack, actions, appels MCP. Jamais de titre de PR, de commentaire, de message Slack ni de jeton.",
    sections: { log: "Journal", viewer: "Dernières entrées" },
    logDescription:
      "Rien n'est envoyé : le journal sert à diagnostiquer un problème.",
    enable: "Tenir un journal d'activité",
    enableDescription: "Activé par défaut.",
    retention: "Conservation",
    retentionDescription:
      "Les entrées plus anciennes sont supprimées au lancement puis toutes les heures.",
    retentions: { "24h": "24 h", "7d": "7 jours", custom: "Personnalisée" },
    days: "jours",
    daysLabel: (min: number, max: number) =>
      `Nombre de jours (${min} à ${max})`,
    folder: "Dossier",
    folderDefault: "Dossier par défaut de l'app",
    change: "Changer…",
    reset: "Par défaut",
    open: "Ouvrir le dossier",
    viewerDescription: (n: number) =>
      `Les ${n} plus récentes, la plus récente en haut.`,
    levels: { all: "Tout", warn: "Avertissements", error: "Erreurs" },
    filter: "Niveau",
    refresh: "Relire",
    copy: "Copier",
    copied: "Copié",
    export: "Exporter…",
    exported: "Exporté",
    empty: "Aucune entrée",
    disabled: "Journal désactivé : aucune nouvelle entrée.",
    error: (m: string) => `Erreur : ${m}`,
    keywords: "logs journal diagnostic plantage crash débogage",
  },
  {
    subtitle:
      "Activity log kept on this machine only: refreshes, GitHub and Slack errors, actions, MCP calls. Never PR titles, comments, Slack messages or tokens.",
    sections: { log: "Log", viewer: "Latest entries" },
    logDescription: "Nothing is sent: the log helps diagnose a problem.",
    enable: "Keep an activity log",
    enableDescription: "On by default.",
    retention: "Retention",
    retentionDescription:
      "Older entries are deleted at launch, then every hour.",
    retentions: { "24h": "24 h", "7d": "7 days", custom: "Custom" },
    days: "days",
    daysLabel: (min: number, max: number) =>
      `Number of days (${min} to ${max})`,
    folder: "Folder",
    folderDefault: "App's default folder",
    change: "Change…",
    reset: "Reset to default",
    open: "Open folder",
    viewerDescription: (n: number) => `The ${n} most recent, newest first.`,
    levels: { all: "All", warn: "Warnings", error: "Errors" },
    filter: "Level",
    refresh: "Reload",
    copy: "Copy",
    copied: "Copied",
    export: "Export…",
    exported: "Exported",
    empty: "No entry",
    disabled: "Log off: no new entry.",
    error: (m: string) => `Error: ${m}`,
    keywords: "logs journal diagnostic crash debug troubleshooting",
  },
)

type Filter = "all" | Exclude<LogLevel, "info">

const LEVEL_CLASS: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Réglages du journal : activation, conservation, dossier. */
function LogSection() {
  const t = useStrings(S)
  const s = useSettings()
  const [dir, setDir] = useState<LogDir | null>(null)
  const [days, setDays] = useState(String(s.logRetentionDays))
  const [error, setError] = useState("")

  // dossier effectif affiché ; un dossier enregistré devenu inutilisable : erreur affichée
  useEffect(() => {
    resolveLogDir(s.logDir).then(
      (d) => {
        setDir(d)
        setError("")
      },
      (e: unknown) => setError(message(e)),
    )
  }, [s.logDir])
  useEffect(() => setDays(String(s.logRetentionDays)), [s.logRetentionDays])

  /** conservation changée : purge tout de suite avec la nouvelle durée */
  const retain = (patch: {
    logRetention?: LogRetention
    logRetentionDays?: number
  }) => {
    updateSettings(patch)
    purgeLog().catch((e: unknown) => setError(message(e)))
  }

  const change = async () => {
    try {
      const picked = await pickLogDir()
      if (picked) updateSettings({ logDir: picked })
    } catch (e) {
      setError(message(e))
    }
  }

  const applyDays = () => {
    const n = Number(days)
    const valid = logDaysOf(n) === n
    if (!valid) setDays(String(s.logRetentionDays))
    else if (n !== s.logRetentionDays) retain({ logRetentionDays: n })
  }

  return (
    <Section
      id="diagnostic-log"
      title={t.sections.log}
      description={t.logDescription}
    >
      <Row
        id="log-enable"
        label={t.enable}
        labelId="log-enable-label"
        description={t.enableDescription}
      >
        <Toggle
          checked={s.logEnabled}
          onChange={(v) => updateSettings({ logEnabled: v })}
          labelledBy="log-enable-label"
        />
      </Row>
      <Row
        id="log-retention"
        label={t.retention}
        labelId="log-retention-label"
        description={t.retentionDescription}
      >
        <Segmented<LogRetention>
          labelledBy="log-retention-label"
          value={s.logRetention}
          onChange={(v) => retain({ logRetention: v })}
          options={(["24h", "7d", "custom"] as const).map((v) => ({
            value: v,
            label: t.retentions[v],
          }))}
        />
        {s.logRetention === "custom" && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Input
              type="number"
              inputMode="numeric"
              min={LOG_CUSTOM_DAYS_MIN}
              max={LOG_CUSTOM_DAYS_MAX}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              onBlur={applyDays}
              onKeyDown={(e) => e.key === "Enter" && applyDays()}
              aria-label={t.daysLabel(LOG_CUSTOM_DAYS_MIN, LOG_CUSTOM_DAYS_MAX)}
              className="w-20 tabular-nums"
            />
            {t.days}
          </span>
        )}
      </Row>
      <Row
        id="log-folder"
        label={t.folder}
        description={
          <span className="break-all">
            {dir?.dir ?? s.logDir ?? ""}
            {!s.logDir && dir && ` · ${t.folderDefault}`}
          </span>
        }
      >
        <Button variant="outline" size="sm" onClick={() => void change()}>
          {t.change}
        </Button>
        {s.logDir && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateSettings({ logDir: null })}
          >
            {t.reset}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void revealLogDir().catch((e: unknown) => setError(message(e)))
          }
        >
          <FolderOpen data-icon="inline-start" />
          {t.open}
        </Button>
      </Row>
      {error && (
        <p role="alert" className="pb-3 text-xs break-all text-destructive">
          {t.error(error)}
        </p>
      )}
    </Section>
  )
}

const time = (ts: number) =>
  new Date(ts).toLocaleString(locale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

/** Dernières entrées du journal, filtrées par niveau ; copie et export. */
function ViewerSection() {
  const t = useStrings(S)
  const { logEnabled, logDir } = useSettings()
  const [filter, setFilter] = useState<Filter>("all")
  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [error, setError] = useState("")
  const [msg, flash] = useFlash()

  const load = useCallback(() => {
    readLog(LOG_VIEW_LIMIT, filter === "all" ? null : filter).then(
      (list) => {
        setEntries(list)
        setError("")
      },
      (e: unknown) => setError(message(e)),
    )
  }, [filter])
  // dossier changé : relu depuis le nouveau dossier
  useEffect(load, [load, logDir])

  const copy = () =>
    navigator.clipboard.writeText(toJsonl(entries ?? [])).then(
      () => flash(t.copied),
      (e: unknown) => setError(message(e)),
    )

  const save = () =>
    exportLog().then(
      (path) => path && flash(t.exported),
      (e: unknown) => setError(message(e)),
    )

  return (
    <Section
      id="diagnostic-viewer"
      title={t.sections.viewer}
      description={t.viewerDescription(LOG_VIEW_LIMIT)}
    >
      <Row id="log-viewer" label={t.filter} labelId="log-filter-label">
        <Segmented<Filter>
          labelledBy="log-filter-label"
          value={filter}
          onChange={setFilter}
          options={(["all", "warn", "error"] as const).map((v) => ({
            value: v,
            label: t.levels[v],
          }))}
        />
      </Row>
      <div className="-mx-4 flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw data-icon="inline-start" />
          {t.refresh}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!entries?.length}
          onClick={() => void copy()}
        >
          <Copy data-icon="inline-start" />
          {t.copy}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void save()}>
          <Download data-icon="inline-start" />
          {t.export}
        </Button>
        <Feedback msg={msg} />
      </div>
      {!logEnabled && (
        <p className="pb-2 text-xs text-muted-foreground">{t.disabled}</p>
      )}
      {error && (
        <p role="alert" className="pb-3 text-xs break-all text-destructive">
          {t.error(error)}
        </p>
      )}
      <div className="-mx-4 max-h-96 overflow-auto border-t bg-muted/30 px-4 py-2 font-mono text-xs">
        {entries && !entries.length && (
          <p className="py-4 text-center font-sans text-muted-foreground">
            {t.empty}
          </p>
        )}
        <ul>
          {entries?.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="flex gap-2 py-0.5 leading-5">
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {time(e.ts)}
              </span>
              <span
                className={cn("w-10 shrink-0 uppercase", LEVEL_CLASS[e.level])}
              >
                {e.level}
              </span>
              <span className="shrink-0 font-medium">{e.event}</span>
              {e.data !== undefined && (
                <span className="min-w-0 break-all text-muted-foreground">
                  {JSON.stringify(e.data)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  )
}

/** Catégorie « Diagnostic » : journal d'activité local, appli de bureau seulement. */
export function DiagnosticCategory() {
  const t = useStrings(S)
  return (
    <>
      <p className="-mt-3 text-sm text-muted-foreground">{t.subtitle}</p>
      <LogSection />
      <ViewerSection />
    </>
  )
}

/** Lignes de la catégorie pour la recherche des réglages, dans l'ordre d'affichage. */
export function diagnosticEntries(lang: Lang): SettingsEntry[] {
  const t = S[lang]
  const base = { category: "diagnostic" as const, desktopOnly: true }
  return [
    {
      ...base,
      id: "log-enable",
      label: t.enable,
      description: t.subtitle,
      keywords: t.keywords,
    },
    {
      ...base,
      id: "log-retention",
      label: t.retention,
      description: t.retentionDescription,
      keywords: words(t.keywords, ...Object.values(t.retentions)),
    },
    {
      ...base,
      id: "log-folder",
      label: t.folder,
      description: t.folderDefault,
      keywords: words(t.keywords, t.change, t.open),
    },
    {
      ...base,
      id: "log-viewer",
      label: t.sections.viewer,
      description: t.viewerDescription(LOG_VIEW_LIMIT),
      keywords: words(t.keywords, t.copy, t.export, t.filter),
    },
  ]
}
