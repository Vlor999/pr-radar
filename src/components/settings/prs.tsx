import { ChevronDown, Loader2 } from "lucide-react"
import { useState } from "react"

import { words, type SettingsEntry } from "@/components/settings/category"
import {
  Feedback,
  Row,
  Section,
  Segmented,
  Toggle,
  useConfirm,
  useFlash,
} from "@/components/settings/ui"
import { Button } from "@/components/ui/button"
import { reposWithMyOpenPrs } from "@/lib/github"
import { strings, useStrings, type Lang } from "@/lib/i18n"
import { useAutoInterval } from "@/lib/quota"
import { MINUTE_MS } from "@/lib/quiet"
import { updateSettings, useSettings } from "@/lib/settings"
import { getRepos, reload, setRepos } from "@/lib/store"

const S = strings(
  {
    sections: {
      display: "Affichage des PR",
      repos: "Repos suivis",
      refresh: "Actualisation",
    },
    failed: "Échec",
    refresh: {
      description: "Quand PR Radar relit GitHub.",
      frequency: "Fréquence",
      manual: "Manuelle",
      auto: (min: number) => `Auto · ${min} min`,
      onFocus: "Actualiser en revenant sur la fenêtre",
    },
    display: {
      description: "Tri et repères de la vue des PR.",
      sort: "Tri par défaut",
      priority: "Priorité",
      oldest: "Plus anciennes",
      recent: "Plus récentes",
      stale: "Inactive après",
      staleDescription: "Jours sans activité avant le badge « inactive ».",
      merged: "Mergées récemment",
      mergedDescription: "Période affichée sous chaque repo.",
      days: (n: number) => `${n} j`,
    },
    repos: {
      description:
        "La liste se gère dans le panneau de gauche de la vue des PR.",
      count: (n: number) => `${n} repo(s)`,
      confirm: "Confirmer — remplace la liste actuelle",
      follow: "Suivre les repos où j'ai des PR ouvertes",
    },
  },
  {
    sections: {
      display: "PR display",
      repos: "Tracked repos",
      refresh: "Refresh",
    },
    failed: "Failed",
    refresh: {
      description: "When PR Radar re-reads GitHub.",
      frequency: "Frequency",
      manual: "Manual",
      auto: (min: number) => `Auto · ${min} min`,
      onFocus: "Refresh when returning to the window",
    },
    display: {
      description: "Sorting and cues for the PR view.",
      sort: "Default sort",
      priority: "Priority",
      oldest: "Oldest",
      recent: "Newest",
      stale: "Stale after",
      staleDescription: 'Days without activity before the "stale" badge.',
      merged: "Recently merged",
      mergedDescription: "Period shown under each repo.",
      days: (n: number) => `${n} d`,
    },
    repos: {
      description: "Manage the list in the left panel of the PR view.",
      count: (n: number) => `${n} repo(s)`,
      confirm: "Confirm — replaces the current list",
      follow: "Track the repos where I have open PRs",
    },
  },
)

/** Catégorie « PR et repos » : affichage, repos suivis, actualisation. */
export function PrsCategory() {
  return (
    <>
      <DisplaySection />
      <ReposSection />
      <RefreshSection />
    </>
  )
}

/** Lignes de la catégorie pour la recherche des réglages, dans l'ordre d'affichage. */
export function prsEntries(lang: Lang): SettingsEntry[] {
  const t = S[lang]
  return [
    {
      id: "sort",
      category: "prs",
      label: t.display.sort,
      keywords: words(t.display.priority, t.display.oldest, t.display.recent),
    },
    {
      id: "stale",
      category: "prs",
      label: t.display.stale,
      description: t.display.staleDescription,
    },
    {
      id: "merged",
      category: "prs",
      label: t.display.merged,
      description: t.display.mergedDescription,
    },
    {
      id: "repos",
      category: "prs",
      label: t.sections.repos,
      description: t.repos.description,
      keywords: t.repos.follow,
    },
    {
      id: "frequency",
      category: "prs",
      label: t.refresh.frequency,
      description: t.refresh.description,
      keywords: words(t.sections.refresh, t.refresh.manual),
    },
    {
      id: "on-focus",
      category: "prs",
      label: t.refresh.onFocus,
    },
  ]
}

function DisplaySection() {
  const s = useSettings()
  const t = useStrings(S)
  const days = (n: number[]) =>
    n.map((d) => ({ value: d, label: t.display.days(d) }))
  return (
    <Section
      id="display"
      title={t.sections.display}
      description={t.display.description}
    >
      <Row id="sort" label={t.display.sort} labelId="sort-label">
        <Segmented
          labelledBy="sort-label"
          value={s.defaultSort}
          onChange={(v) => updateSettings({ defaultSort: v })}
          options={[
            { value: "priority", label: t.display.priority },
            { value: "oldest", label: t.display.oldest },
            { value: "recent", label: t.display.recent },
          ]}
        />
      </Row>
      <Row
        id="stale"
        label={t.display.stale}
        labelId="stale-label"
        description={t.display.staleDescription}
      >
        <Segmented
          labelledBy="stale-label"
          value={s.staleDays}
          onChange={(v) => updateSettings({ staleDays: v })}
          options={days([3, 5, 7, 14, 30])}
        />
      </Row>
      <Row
        id="merged"
        label={t.display.merged}
        labelId="merged-label"
        description={t.display.mergedDescription}
      >
        <Segmented
          labelledBy="merged-label"
          value={s.mergedDays}
          onChange={(v) => {
            updateSettings({ mergedDays: v })
            void reload()
          }}
          options={days([7, 14, 30])}
        />
      </Row>
    </Section>
  )
}

function ReposSection() {
  const [count, setCount] = useState(() => getRepos()?.length ?? 0)
  const [armed, confirm] = useConfirm()
  const [busy, setBusy] = useState(false)
  const [msg, flash] = useFlash()
  const t = useStrings(S)
  const follow = async () => {
    setBusy(true)
    try {
      const repos = await reposWithMyOpenPrs()
      setRepos(repos)
      setCount(repos.length)
      flash()
      void reload()
    } catch {
      flash(t.failed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      id="repos"
      title={t.sections.repos}
      description={t.repos.description}
    >
      <Row
        id="repos"
        label={t.sections.repos}
        description={t.repos.count(count)}
      >
        <Feedback msg={msg} />
        <Button
          variant={armed ? "destructive" : "outline"}
          size="sm"
          disabled={busy}
          onClick={() => confirm(() => void follow())}
        >
          {busy && (
            <Loader2
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          )}
          {armed ? t.repos.confirm : t.repos.follow}
        </Button>
      </Row>
    </Section>
  )
}

function RefreshSection() {
  const s = useSettings()
  const autoMs = useAutoInterval()
  const t = useStrings(S)
  return (
    <Section
      id="refresh"
      title={t.sections.refresh}
      description={t.refresh.description}
    >
      <Row id="frequency" label={t.refresh.frequency} labelId="refresh-label">
        {/* appearance-none : sinon le navigateur impose son propre style (pilule sombre) */}
        <div className="relative">
          <select
            aria-labelledby="refresh-label"
            value={s.refreshMinutes}
            onChange={(e) =>
              updateSettings({
                refreshMinutes:
                  e.target.value === "auto" ? "auto" : Number(e.target.value),
              })
            }
            className="h-8 appearance-none rounded-lg border bg-background pr-7 pl-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            {(["auto", 0, 1, 2, 5, 10, 15, 30] as const).map((m) => (
              <option key={m} value={m}>
                {m === "auto"
                  ? t.refresh.auto(Math.round(autoMs / MINUTE_MS))
                  : m === 0
                    ? t.refresh.manual
                    : `${m} min`}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
      </Row>
      <Row id="on-focus" label={t.refresh.onFocus} labelId="focus-label">
        <Toggle
          labelledBy="focus-label"
          checked={s.refreshOnFocus}
          onChange={(v) => updateSettings({ refreshOnFocus: v })}
        />
      </Row>
    </Section>
  )
}
