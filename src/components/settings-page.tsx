import { getVersion } from "@tauri-apps/api/app"
import { invoke } from "@tauri-apps/api/core"
import { cn } from "cn"
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  Trash2,
} from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SHORTCUTS } from "@/hooks/use-keyboard-nav"
import {
  testNotification,
  useLastNotification,
} from "@/hooks/use-pr-notifications"
import { resetSeen } from "@/hooks/use-seen"
import { useTheme, type ThemeMode } from "@/hooks/use-theme"
import { authSource, CLIENT_ID, logout } from "@/lib/auth"
import {
  clearCache,
  reposWithMyOpenPrs,
  viewerProfile,
  type Profile,
} from "@/lib/github"
import { currentLang, locale, strings, useStrings, type Lang } from "@/lib/i18n"
import { openExternal } from "@/lib/open"
import { LOW, resetTime, useQuota } from "@/lib/quota"
import { resetSettings, updateSettings, useSettings } from "@/lib/settings"
import { checkForUpdate, installUpdate, useUpdate } from "@/lib/updater"
import { getRepos, reload, setRepos } from "@/lib/store"

const SECTIONS = [
  "compte",
  "apparence",
  "actualisation",
  "notifications",
  "affichage",
  "repos",
  "donnees",
  "raccourcis",
  "a-propos",
] as const

const S = strings(
  {
    sections: {
      compte: "Compte",
      apparence: "Apparence",
      actualisation: "Actualisation",
      notifications: "Notifications",
      affichage: "Affichage des PR",
      repos: "Repos suivis",
      donnees: "Données",
      raccourcis: "Raccourcis clavier",
      "a-propos": "À propos",
    },
    done: "Fait",
    failed: "Échec",
    account: {
      description: "Le compte GitHub utilisé pour lire vos PR.",
      profileError: "Impossible de charger le profil GitHub.",
      via: "Connecté via",
      ghNote:
        "Se déconnecter arrête de réutiliser le compte du CLI gh jusqu'à la prochaine connexion.",
      oauth: "GitHub (connexion OAuth)",
      pat: "Jeton personnel",
      gh: "CLI gh",
      unknown: "Inconnu",
      session: "Session",
      manage: "Gérer l'accès sur GitHub",
      logout: "Se déconnecter",
    },
    appearance: {
      description: "Le thème de l'interface.",
      theme: "Thème",
      shortcut: "Raccourci : d",
      light: "Clair",
      dark: "Sombre",
      auto: "Auto",
    },
    refresh: {
      description: "Quand PR Radar relit GitHub.",
      frequency: "Fréquence",
      manual: "Manuelle",
      onFocus: "Actualiser en revenant sur la fenêtre",
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
    notifications: {
      description:
        "Notifications système envoyées quand une PR change, tant que l'app est ouverte.",
      test: "Tester",
      sent: "Envoyée. Rien n'est apparu ? Le système bloque PR Radar : voir ci-dessous.",
      error: (message: string) => `Échec : ${message}`,
      testHint: "Envoie une notification maintenant pour vérifier.",
      sendTest: "Envoyer une notification de test",
      last: "Dernière notification",
      none: "Aucune pour l'instant.",
      system: "Autorisation du système",
      systemDescription:
        "C'est le système qui affiche ou bloque les notifications. Vérifie que PR Radar y est autorisée (bannières ou alertes).",
      openSystem: "Ouvrir les réglages du système",
      approved: "Approbation",
      changesRequested: "Changements demandés",
      comments: "Nouveaux commentaires",
      ciFailed: "CI en échec",
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
    shortcuts: {
      description: "Actifs hors des champs de saisie.",
      openSettings: "ouvrir les réglages",
      esc: "Échap",
      closeSettings: "fermer les réglages",
    },
    about: {
      description:
        "Gratuit, open source (MIT). Aucun serveur : l'app parle directement à GitHub.",
      version: (v: string | null) => (v ? `Version ${v}` : "Version …"),
      upToDate: "À jour",
      updateError: "Mise à jour impossible",
      available: (v: string) => `Version ${v} disponible`,
      downloading: "Téléchargement",
      restarting: "Redémarrage…",
      install: "Installer et redémarrer",
      check: "Rechercher une mise à jour",
      links: "Liens",
      source: "Code source",
      download: "Page de téléchargement",
      report: "Signaler un problème",
    },
    nav: "Sections des réglages",
    back: "Retour",
  },
  {
    sections: {
      compte: "Account",
      apparence: "Appearance",
      actualisation: "Refresh",
      notifications: "Notifications",
      affichage: "PR display",
      repos: "Tracked repos",
      donnees: "Data",
      raccourcis: "Keyboard shortcuts",
      "a-propos": "About",
    },
    done: "Done",
    failed: "Failed",
    account: {
      description: "The GitHub account used to read your PRs.",
      profileError: "Couldn't load the GitHub profile.",
      via: "Signed in with",
      ghNote:
        "Signing out stops reusing the gh CLI account until the next sign-in.",
      oauth: "GitHub (OAuth sign-in)",
      pat: "Personal token",
      gh: "gh CLI",
      unknown: "Unknown",
      session: "Session",
      manage: "Manage access on GitHub",
      logout: "Sign out",
    },
    appearance: {
      description: "The interface theme.",
      theme: "Theme",
      shortcut: "Shortcut: d",
      light: "Light",
      dark: "Dark",
      auto: "Auto",
    },
    refresh: {
      description: "When PR Radar re-reads GitHub.",
      frequency: "Frequency",
      manual: "Manual",
      onFocus: "Refresh when returning to the window",
      quota: "GitHub quota",
      quotaDescription: "GraphQL points per hour. Notifies below 10% left.",
      quotaMeter: "GitHub quota remaining",
      quotaLine: (remaining: string, limit: string, reset: string) =>
        `${remaining} / ${limit} left · resets at ${reset}`,
      quotaUnknown: "Unknown until the first refresh",
      reloadAll: "Reload everything now",
      reloadNow: "Refresh now",
    },
    notifications: {
      description:
        "System notifications sent when a PR changes, while the app is open.",
      test: "Test",
      sent: "Sent. Nothing showed up? The system is blocking PR Radar: see below.",
      error: (message: string) => `Failed: ${message}`,
      testHint: "Sends a notification now to check.",
      sendTest: "Send a test notification",
      last: "Last notification",
      none: "None yet.",
      system: "System permission",
      systemDescription:
        "The system shows or blocks notifications. Check that PR Radar is allowed there (banners or alerts).",
      openSystem: "Open system settings",
      approved: "Approval",
      changesRequested: "Changes requested",
      comments: "New comments",
      ciFailed: "CI failed",
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
    shortcuts: {
      description: "Active outside text fields.",
      openSettings: "open settings",
      esc: "Esc",
      closeSettings: "close settings",
    },
    about: {
      description:
        "Free, open source (MIT). No server: the app talks directly to GitHub.",
      version: (v: string | null) => (v ? `Version ${v}` : "Version …"),
      upToDate: "Up to date",
      updateError: "Update failed",
      available: (v: string) => `Version ${v} available`,
      downloading: "Downloading",
      restarting: "Restarting…",
      install: "Install and restart",
      check: "Check for updates",
      links: "Links",
      source: "Source code",
      download: "Download page",
      report: "Report an issue",
    },
    nav: "Settings sections",
    back: "Back",
  },
)

const DOWNLOAD_URL = "https://vlor999.github.io/pr-radar/"
const REPO_URL = "https://github.com/Vlor999/pr-radar"

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.matches("input, textarea, select") || t.isContentEditable)

/* ---------- Briques ---------- */

function Section(props: {
  id: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section
      id={props.id}
      aria-labelledby={`${props.id}-title`}
      className="scroll-mt-4"
    >
      <h2 id={`${props.id}-title`} className="text-base font-semibold">
        {props.title}
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {props.description}
      </p>
      <div className="mt-3 rounded-2xl border bg-card px-4">
        {props.children}
      </div>
    </section>
  )
}

function Row(props: {
  label: ReactNode
  description?: ReactNode
  labelId?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 border-t py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div id={props.labelId} className="text-sm font-medium">
          {props.label}
        </div>
        {props.description && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {props.description}
          </div>
        )}
      </div>
      {props.children && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {props.children}
        </div>
      )}
    </div>
  )
}

function Toggle(props: {
  checked: boolean
  onChange: (v: boolean) => void
  labelledBy: string
  muted?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-labelledby={props.labelledBy}
      onClick={() => props.onChange(!props.checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none",
        props.checked ? "bg-primary" : "bg-input",
        props.muted && "opacity-50",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
          props.checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

function Segmented<T extends string | number>(props: {
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (v: T) => void
  labelledBy: string
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={props.labelledBy}
      className="inline-flex flex-wrap rounded-lg border bg-muted p-0.5"
    >
      {props.options.map((o) => {
        const active = o.value === props.value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => props.onChange(o.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none [&_svg]:size-3.5",
              active
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Libellé « Fait » affiché 2 s après une action. */
function useFlash(): [string | null, (msg?: string) => void] {
  const t = useStrings(S)
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    msg,
    (m = t.done) => {
      setMsg(m)
      clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setMsg(null), 2000)
    },
  ]
}

/** Confirmation en deux clics : le premier arme le bouton pendant 4 s. */
function useConfirm(): [boolean, (action: () => void) => void] {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    armed,
    (action) => {
      clearTimeout(timer.current)
      if (armed) {
        setArmed(false)
        action()
      } else {
        setArmed(true)
        timer.current = window.setTimeout(() => setArmed(false), 4000)
      }
    },
  ]
}

const Feedback = ({ msg }: { msg: string | null }) => (
  <span aria-live="polite" className="min-w-8 text-xs text-muted-foreground">
    {msg}
  </span>
)

/* ---------- Sections ---------- */

function AccountSection() {
  const t = useStrings(S)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState(false)
  const source = authSource()
  useEffect(() => {
    viewerProfile().then(setProfile, () => setError(true))
  }, [])
  const manageUrl =
    source === "oauth"
      ? `https://github.com/settings/connections/applications/${CLIENT_ID}`
      : source === "pat"
        ? "https://github.com/settings/tokens"
        : null
  return (
    <Section
      id="compte"
      title={t.sections.compte}
      description={t.account.description}
    >
      <div className="flex h-16 items-center gap-3 py-3">
        {profile ? (
          <>
            <img
              src={profile.avatarUrl}
              alt=""
              className="size-10 rounded-full bg-muted"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {profile.name ?? profile.login}
              </div>
              <a
                href={profile.url}
                className="text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                @{profile.login}
              </a>
            </div>
          </>
        ) : error ? (
          <p className="text-sm text-destructive">{t.account.profileError}</p>
        ) : (
          <>
            <div className="size-10 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-32 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </div>
          </>
        )}
      </div>
      <Row
        label={t.account.via}
        description={source === "gh" ? t.account.ghNote : undefined}
      >
        <span className="text-sm text-muted-foreground">
          {source === "oauth"
            ? t.account.oauth
            : source === "pat"
              ? t.account.pat
              : source === "gh"
                ? t.account.gh
                : t.account.unknown}
        </span>
      </Row>
      <Row label={t.account.session}>
        {manageUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openExternal(manageUrl)}
          >
            {t.account.manage}
            <ExternalLink data-icon="inline-end" />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => void logout()}
        >
          <LogOut data-icon="inline-start" />
          {t.account.logout}
        </Button>
      </Row>
    </Section>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const { lang } = useSettings()
  const t = useStrings(S)
  return (
    <Section
      id="apparence"
      title={t.sections.apparence}
      description={t.appearance.description}
    >
      <Row
        label={t.appearance.theme}
        labelId="theme-label"
        description={t.appearance.shortcut}
      >
        <Segmented<ThemeMode>
          labelledBy="theme-label"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: t.appearance.light, icon: <Sun /> },
            { value: "dark", label: t.appearance.dark, icon: <Moon /> },
            { value: "system", label: t.appearance.auto, icon: <Monitor /> },
          ]}
        />
      </Row>
      <Row label="Langue · Language" labelId="lang-label">
        <Segmented<Lang>
          labelledBy="lang-label"
          value={currentLang(lang)}
          onChange={(v) => updateSettings({ lang: v })}
          options={[
            { value: "fr", label: "Français" },
            { value: "en", label: "English" },
          ]}
        />
      </Row>
    </Section>
  )
}

function RefreshSection() {
  const s = useSettings()
  const quota = useQuota()
  const t = useStrings(S)
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setBusy(true)
    clearCache()
    await reload().finally(() => setBusy(false))
  }
  return (
    <Section
      id="actualisation"
      title={t.sections.actualisation}
      description={t.refresh.description}
    >
      <Row label={t.refresh.frequency} labelId="refresh-label">
        <select
          aria-labelledby="refresh-label"
          value={s.refreshMinutes}
          onChange={(e) =>
            updateSettings({ refreshMinutes: Number(e.target.value) })
          }
          className="h-8 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {[0, 1, 2, 5, 10, 15, 30].map((m) => (
            <option key={m} value={m}>
              {m === 0 ? t.refresh.manual : `${m} min`}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t.refresh.onFocus} labelId="focus-label">
        <Toggle
          labelledBy="focus-label"
          checked={s.refreshOnFocus}
          onChange={(v) => updateSettings({ refreshOnFocus: v })}
        />
      </Row>
      <Row label={t.refresh.quota} description={t.refresh.quotaDescription}>
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
      <Row label={t.refresh.reloadAll}>
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

const NOTIFY = ["approved", "changesRequested", "comments", "ciFailed"] as const

// sur ordinateur, c'est le système qui autorise ou bloque : on renvoie vers ses réglages
const SYSTEM_NOTIFICATION_SETTINGS = navigator.userAgent.includes("Mac")
  ? "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
  : navigator.userAgent.includes("Windows")
    ? "ms-settings:notifications"
    : null

function NotificationsSection() {
  const s = useSettings()
  const last = useLastNotification()
  const t = useStrings(S)
  const [test, setTest] = useState<
    { state: "sending" | "sent" } | { state: "error"; message: string } | null
  >(null)
  const send = () => {
    setTest({ state: "sending" })
    testNotification().then(
      () => setTest({ state: "sent" }),
      (e: unknown) => setTest({ state: "error", message: String(e) }),
    )
  }
  return (
    <Section
      id="notifications"
      title={t.sections.notifications}
      description={t.notifications.description}
    >
      <Row
        label={t.notifications.test}
        description={
          test?.state === "sent"
            ? t.notifications.sent
            : test?.state === "error"
              ? t.notifications.error(test.message)
              : t.notifications.testHint
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={test?.state === "sending"}
          onClick={send}
        >
          {t.notifications.sendTest}
        </Button>
      </Row>
      <Row
        label={t.notifications.last}
        description={
          last
            ? `${last.title} · ${new Date(last.at).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" })}`
            : t.notifications.none
        }
      />
      {SYSTEM_NOTIFICATION_SETTINGS && (
        <Row
          label={t.notifications.system}
          description={t.notifications.systemDescription}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => openExternal(SYSTEM_NOTIFICATION_SETTINGS)}
          >
            {t.notifications.openSystem}
          </Button>
        </Row>
      )}
      {NOTIFY.map((key) => (
        <Row key={key} label={t.notifications[key]} labelId={`notify-${key}`}>
          <Toggle
            labelledBy={`notify-${key}`}
            checked={s.notify[key]}
            onChange={(v) => updateSettings({ notify: { [key]: v } })}
          />
        </Row>
      ))}
    </Section>
  )
}

function DisplaySection() {
  const s = useSettings()
  const t = useStrings(S)
  const days = (n: number[]) =>
    n.map((d) => ({ value: d, label: t.display.days(d) }))
  return (
    <Section
      id="affichage"
      title={t.sections.affichage}
      description={t.display.description}
    >
      <Row label={t.display.sort} labelId="sort-label">
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
      <Row label={t.sections.repos} description={t.repos.count(count)}>
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

function DataSection() {
  const [cacheMsg, flashCache] = useFlash()
  const [seenMsg, flashSeen] = useFlash()
  const [resetMsg, flashReset] = useFlash()
  const [armed, confirm] = useConfirm()
  const t = useStrings(S)
  return (
    <Section
      id="donnees"
      title={t.sections.donnees}
      description={t.data.description}
    >
      <Row label={t.data.cache} description={t.data.cacheDescription}>
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
      <Row label={t.data.seen} description={t.data.seenDescription}>
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
      <Row label={t.data.settings} description={t.data.settingsDescription}>
        <Feedback msg={resetMsg} />
        <Button
          variant={armed ? "destructive" : "outline"}
          size="sm"
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
      <UninstallRow />
    </Section>
  )
}

type UninstallPlan = {
  appPath: string | null
  dataPaths: string[]
  note: "linux-package" | "windows-settings" | null
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
    invoke<UninstallPlan>("uninstall_plan").then(setPlan, (e: unknown) => {
      setState("error")
      setError(String(e))
    })
  }

  const run = async () => {
    setState("running")
    try {
      try {
        localStorage.clear() // réglages, repos suivis, marques « vu »
      } catch {}
      await invoke("uninstall_run") // jeton supprimé, nettoyage après fermeture, puis l'app quitte
    } catch (e) {
      setState("error")
      setError(String(e))
    }
  }

  return (
    <div className="border-t py-3">
      <Row label={t.uninstall.label} description={t.uninstall.description}>
        {!open && (
          <Button variant="destructive" size="sm" onClick={show}>
            <Trash2 />
            {t.uninstall.button}
          </Button>
        )}
      </Row>
      {open && (
        <div className="mb-1 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
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

function ShortcutsSection() {
  const t = useStrings(S)
  const rows = [
    ...useStrings(SHORTCUTS),
    { keys: "⌘ ,", label: t.shortcuts.openSettings },
    { keys: t.shortcuts.esc, label: t.shortcuts.closeSettings },
  ]
  return (
    <Section
      id="raccourcis"
      title={t.sections.raccourcis}
      description={t.shortcuts.description}
    >
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.keys} className="border-t first:border-t-0">
              <td className="w-28 py-2">
                <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {r.keys}
                </kbd>
              </td>
              <td className="py-2 text-muted-foreground">{r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function AboutSection() {
  const [version, setVersion] = useState<string | null>(null)
  const update = useUpdate()
  const t = useStrings(S)
  useEffect(() => {
    getVersion().then(setVersion, () => {})
  }, [])
  const busy =
    update.status === "checking" ||
    update.status === "downloading" ||
    update.status === "ready"
  return (
    <Section
      id="a-propos"
      title={t.sections["a-propos"]}
      description={t.about.description}
    >
      <Row label="PR Radar" description={t.about.version(version)}>
        <span aria-live="polite" className="text-xs">
          {update.status === "up-to-date" && (
            <span className="text-muted-foreground">{t.about.upToDate}</span>
          )}
          {update.status === "error" && (
            <span className="text-destructive" title={update.message}>
              {t.about.updateError}
            </span>
          )}
          {update.status === "available" && (
            <span className="font-medium text-primary">
              {t.about.available(update.version)}
            </span>
          )}
          {update.status === "downloading" && (
            <span className="text-muted-foreground">
              {t.about.downloading}
              {update.progress !== null
                ? ` · ${Math.round(update.progress * 100)} %`
                : "…"}
            </span>
          )}
          {update.status === "ready" && (
            <span className="text-muted-foreground">{t.about.restarting}</span>
          )}
        </span>
        {update.status === "available" ? (
          <Button size="sm" onClick={() => void installUpdate()}>
            {t.about.install}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void checkForUpdate()}
          >
            {busy && (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
              />
            )}
            {t.about.check}
          </Button>
        )}
      </Row>
      <Row label={t.about.links}>
        {[
          [t.about.source, REPO_URL],
          [t.about.download, DOWNLOAD_URL],
          [t.about.report, `${REPO_URL}/issues/new`],
        ].map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="inline-flex items-center gap-1 rounded text-sm text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            {label}
            <ExternalLink className="size-3" />
          </a>
        ))}
      </Row>
    </Section>
  )
}

/* ---------- Page ---------- */

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const t = useStrings(S)
  const [active, setActive] = useState<string>(SECTIONS[0])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting)
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: "0px 0px -70% 0px" },
    )
    SECTIONS.forEach((id) => {
      const el = document.getElementById(id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [])

  const go = (id: string) => {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "start",
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-8 md:px-6">
      <nav
        aria-label={t.nav}
        className="shrink-0 md:sticky md:top-4 md:w-48 md:self-start"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="mb-2 -ml-2"
        >
          <ArrowLeft data-icon="inline-start" />
          {t.back}
        </Button>
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
          {SECTIONS.map((id) => (
            <li key={id} className="shrink-0">
              <button
                type="button"
                onClick={() => go(id)}
                aria-current={active === id ? "true" : undefined}
                className={cn(
                  "w-full rounded-lg px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none",
                  active === id
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {t.sections[id]}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex w-full max-w-2xl min-w-0 flex-col gap-8 pb-16">
        <AccountSection />
        <AppearanceSection />
        <RefreshSection />
        <NotificationsSection />
        <DisplaySection />
        <ReposSection />
        <DataSection />
        <ShortcutsSection />
        <AboutSection />
      </div>
    </div>
  )
}
