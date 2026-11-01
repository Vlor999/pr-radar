import { cn } from "cn"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
import { useState } from "react"

import { words, type SettingsEntry } from "@/components/settings/category"
import {
  Feedback,
  Row,
  Section,
  useConfirm,
  useFlash,
} from "@/components/settings/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { resetSeen } from "@/hooks/use-seen"
import { refreshPrs } from "@/lib/actions"
import { forgetTokens } from "@/lib/auth"
import { clearCache } from "@/lib/github"
import { locale, strings, useStrings, type Lang } from "@/lib/i18n"
import { getLogSettings } from "@/lib/log-settings"
import { invoke, isWeb } from "@/lib/platform"
import { LOW, resetTime, useQuota } from "@/lib/quota"
import { resetSettings } from "@/lib/settings"
import { disconnectSlack } from "@/lib/slack"
import { reload } from "@/lib/store"

const S = strings(
  {
    sections: {
      github: "API GitHub",
      data: "Données",
      danger: "Zone sensible",
    },
    github: { description: "Quota de l'API et relecture complète." },
    danger: { description: "Ces actions effacent tes réglages ou l'app." },
    refresh: {
      quota: "Quota GitHub",
      quotaDescription:
        "Points GraphQL par heure. Notification sous 10 % restants.",
      quotaMeter: "Quota GitHub restant",
      quotaLine: (remaining: string, limit: string, reset: string) =>
        `${remaining} / ${limit} restants · réinitialisé à ${reset}`,
      quotaUnknown: "Inconnu avant la première actualisation",
      reloadAll: "Relire tout maintenant",
      reloadNow: "Actualiser maintenant",
    },
    data: {
      description: "Tout est gardé sur cette machine.",
      cache: "Cache",
      cacheDescription: "Relit tout depuis GitHub.",
      clearCache: "Vider le cache",
      seen: "Marques « vu »",
      seenDescription: "Toutes les PR redeviennent nouvelles.",
      forgetSeen: "Oublier les marques « vu »",
      settings: "Réglages",
      settingsDescription: "Revient aux valeurs par défaut.",
      confirmReset: "Confirmer la réinitialisation",
      reset: "Réinitialiser les réglages",
    },
    uninstall: {
      label: "Désinstaller PR Radar",
      description:
        "Supprime l'app et tout ce qu'elle a créé sur cette machine : jeton GitHub, réglages, cache. Ton compte GitHub n'est pas touché.",
      button: "Désinstaller…",
      inventory: "Inventaire de ce qui sera supprimé…",
      willDelete: "Sera supprimé :",
      kept: "Gardé (dossier du journal choisi, à supprimer à la main) :",
      token: "Jeton GitHub du trousseau du système",
      notes: {
        "linux-package":
          "Installée via un paquet système : termine avec `sudo apt remove pr-radar` (ou `sudo dnf remove pr-radar`).",
        "windows-settings":
          "Termine depuis Paramètres > Applications > PR Radar.",
      },
      revoke:
        "Pour révoquer aussi l'accès côté GitHub : Settings → Applications → PR Radar.",
      word: "SUPPRIMER",
      typeToConfirm: (word: string) => `Tape ${word} pour confirmer`,
      confirm: "Tout supprimer et quitter",
      cancel: "Annuler",
      error: (message: string) => `Désinstallation impossible : ${message}`,
    },
  },
  {
    sections: {
      github: "GitHub API",
      data: "Data",
      danger: "Danger zone",
    },
    github: { description: "API quota and full reload." },
    danger: { description: "These actions erase your settings or the app." },
    refresh: {
      quota: "GitHub quota",
      quotaDescription: "GraphQL points per hour. Notifies below 10% left.",
      quotaMeter: "GitHub quota remaining",
      quotaLine: (remaining: string, limit: string, reset: string) =>
        `${remaining} / ${limit} left · resets at ${reset}`,
      quotaUnknown: "Unknown until the first refresh",
      reloadAll: "Reload everything now",
      reloadNow: "Refresh now",
    },
    data: {
      description: "Everything stays on this machine.",
      cache: "Cache",
      cacheDescription: "Re-reads everything from GitHub.",
      clearCache: "Clear cache",
      seen: '"Seen" marks',
      seenDescription: "All PRs become new again.",
      forgetSeen: 'Forget "seen" marks',
      settings: "Settings",
      settingsDescription: "Back to default values.",
      confirmReset: "Confirm reset",
      reset: "Reset settings",
    },
    uninstall: {
      label: "Uninstall PR Radar",
      description:
        "Removes the app and everything it created on this machine: GitHub token, settings, cache. Your GitHub account is untouched.",
      button: "Uninstall…",
      inventory: "Listing what will be removed…",
      willDelete: "Will be removed:",
      kept: "Kept (chosen log folder, delete it by hand):",
      token: "GitHub token in the system keychain",
      notes: {
        "linux-package":
          "Installed through a system package: finish with `sudo apt remove pr-radar` (or `sudo dnf remove pr-radar`).",
        "windows-settings": "Finish from Settings > Apps > PR Radar.",
      },
      revoke:
        "To also revoke access on the GitHub side: Settings → Applications → PR Radar.",
      word: "DELETE",
      typeToConfirm: (word: string) => `Type ${word} to confirm`,
      confirm: "Delete everything and quit",
      cancel: "Cancel",
      error: (message: string) => `Uninstall failed: ${message}`,
    },
  },
)

/** Catégorie « Avancé » : API GitHub, données, zone sensible. */
export function AdvancedCategory() {
  return (
    <>
      <GitHubSection />
      <DataSection />
      <DangerSection />
    </>
  )
}

/** Lignes de la catégorie pour la recherche des réglages, dans l'ordre d'affichage. */
export function advancedEntries(lang: Lang): SettingsEntry[] {
  const t = S[lang]
  return [
    {
      id: "quota",
      category: "advanced",
      label: t.refresh.quota,
      description: t.refresh.quotaDescription,
    },
    {
      id: "reload-all",
      category: "advanced",
      label: t.refresh.reloadAll,
      keywords: t.refresh.reloadNow,
    },
    {
      id: "cache",
      category: "advanced",
      label: t.data.cache,
      description: t.data.cacheDescription,
      keywords: t.data.clearCache,
    },
    {
      id: "seen",
      category: "advanced",
      label: t.data.seen,
      description: t.data.seenDescription,
      keywords: t.data.forgetSeen,
    },
    {
      id: "reset",
      category: "advanced",
      label: t.data.reset,
      description: t.data.settingsDescription,
      keywords: words(t.data.settings, t.sections.danger),
    },
    {
      id: "uninstall",
      desktopOnly: true,
      category: "advanced",
      label: t.uninstall.label,
      description: t.uninstall.description,
      keywords: t.sections.danger,
    },
  ]
}

function GitHubSection() {
  const quota = useQuota()
  const t = useStrings(S)
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setBusy(true)
    await refreshPrs().finally(() => setBusy(false))
  }
  return (
    <Section
      id="github"
      title={t.sections.github}
      description={t.github.description}
    >
      <Row
        id="quota"
        label={t.refresh.quota}
        description={t.refresh.quotaDescription}
      >
        {quota ? (
          <div className="flex w-full flex-col gap-1.5 sm:w-64">
            <div
              role="meter"
              aria-label={t.refresh.quotaMeter}
              aria-valuemin={0}
              aria-valuemax={quota.limit}
              aria-valuenow={quota.remaining}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  quota.remaining <= quota.limit * LOW
                    ? "bg-destructive"
                    : "bg-primary",
                )}
                style={{ width: `${(quota.remaining / quota.limit) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t.refresh.quotaLine(
                quota.remaining.toLocaleString(locale()),
                quota.limit.toLocaleString(locale()),
                resetTime(quota.resetAt),
              )}
            </span>
          </div>
        ) : (
          <span className="text-sm">{t.refresh.quotaUnknown}</span>
        )}
      </Row>
      <Row id="reload-all" label={t.refresh.reloadAll}>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {busy ? (
            <Loader2
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          {t.refresh.reloadNow}
        </Button>
      </Row>
    </Section>
  )
}

function DataSection() {
  const [cacheMsg, flashCache] = useFlash()
  const [seenMsg, flashSeen] = useFlash()
  const t = useStrings(S)
  return (
    <Section id="data" title={t.sections.data} description={t.data.description}>
      <Row
        id="cache"
        label={t.data.cache}
        description={t.data.cacheDescription}
      >
        <Feedback msg={cacheMsg} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            clearCache({ all: true })
            void reload()
            flashCache()
          }}
        >
          {t.data.clearCache}
        </Button>
      </Row>
      <Row id="seen" label={t.data.seen} description={t.data.seenDescription}>
        <Feedback msg={seenMsg} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            resetSeen()
            flashSeen()
          }}
        >
          {t.data.forgetSeen}
        </Button>
      </Row>
    </Section>
  )
}

/** Zone sensible : réinitialisation des réglages et désinstallation. */
function DangerSection() {
  const [resetMsg, flashReset] = useFlash()
  const [armed, confirm] = useConfirm()
  const t = useStrings(S)
  return (
    <Section
      id="danger"
      title={t.sections.danger}
      description={t.danger.description}
      destructive
    >
      <Row
        id="reset"
        label={t.data.settings}
        description={t.data.settingsDescription}
      >
        <Feedback msg={resetMsg} />
        <Button
          variant={armed ? "destructive" : "outline"}
          size="sm"
          className={cn(!armed && "text-destructive hover:text-destructive")}
          onClick={() =>
            confirm(() => {
              resetSettings()
              flashReset()
            })
          }
        >
          {armed ? t.data.confirmReset : t.data.reset}
        </Button>
      </Row>
      {!isWeb && <UninstallRow />}
    </Section>
  )
}

type UninstallPlan = {
  appPath: string | null
  dataPaths: string[]
  note: "linux-package" | "windows-settings" | null
  /** dossier du journal choisi : gardé, à supprimer à la main */
  keptPaths: string[]
}

/** Désinstallation complète : liste ce qui sera supprimé, confirmation tapée, puis l'app se ferme. */
function UninstallRow() {
  const t = useStrings(S)
  const [plan, setPlan] = useState<UninstallPlan | null>(null)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [state, setState] = useState<"idle" | "running" | "error">("idle")
  const [error, setError] = useState("")

  const show = () => {
    setOpen(true)
    invoke<UninstallPlan>("uninstall_plan", {
      logDir: getLogSettings().dir,
    }).then(setPlan, (e: unknown) => {
      setState("error")
      setError(String(e))
    })
  }

  const run = async () => {
    setState("running")
    try {
      // avant localStorage.clear() : la déconnexion réécrit les réglages ; révocation bornée à 5 s
      await disconnectSlack() // jeton Slack révoqué et effacé du trousseau
      try {
        localStorage.clear() // réglages, repos suivis, marques « vu »
      } catch {}
      await forgetTokens() // un jeton par compte ; uninstall_run efface celui d'origine
      await invoke("uninstall_run") // jeton supprimé, nettoyage après fermeture, puis l'app quitte
    } catch (e) {
      setState("error")
      setError(String(e))
    }
  }

  return (
    <div className="border-t">
      <Row
        id="uninstall"
        label={t.uninstall.label}
        description={t.uninstall.description}
      >
        {!open && (
          <Button variant="destructive" size="sm" onClick={show}>
            <Trash2 />
            {t.uninstall.button}
          </Button>
        )}
      </Row>
      {open && (
        <div className="mb-3 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          {!plan && state !== "error" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              {t.uninstall.inventory}
            </p>
          )}
          {plan && (
            <>
              <div>
                <p className="font-medium">{t.uninstall.willDelete}</p>
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs break-all text-muted-foreground">
                  <li>{t.uninstall.token}</li>
                  {plan.appPath && <li>{plan.appPath}</li>}
                  {plan.dataPaths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              {plan.keptPaths.length > 0 && (
                <div>
                  <p className="font-medium">{t.uninstall.kept}</p>
                  <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs break-all text-muted-foreground">
                    {plan.keptPaths.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.note && (
                <p className="text-amber-700 dark:text-amber-400">
                  {t.uninstall.notes[plan.note]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t.uninstall.revoke}
              </p>
              <label
                htmlFor="uninstall-confirm"
                className="text-xs font-medium"
              >
                {t.uninstall.typeToConfirm(t.uninstall.word)}
              </label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="uninstall-confirm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  className="max-w-48"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={
                    typed.trim() !== t.uninstall.word || state === "running"
                  }
                  onClick={() => void run()}
                >
                  {state === "running" ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Trash2 />
                  )}
                  {t.uninstall.confirm}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={state === "running"}
                  onClick={() => {
                    setOpen(false)
                    setTyped("")
                  }}
                >
                  {t.uninstall.cancel}
                </Button>
              </div>
            </>
          )}
          {state === "error" && (
            <p className="text-destructive">{t.uninstall.error(error)}</p>
          )}
        </div>
      )}
    </div>
  )
}
