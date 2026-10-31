import { getVersion } from "@tauri-apps/api/app"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import { cn } from "cn"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Trash2,
} from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Shortcut } from "@/components/shortcut"
import { SHORTCUTS } from "@/hooks/use-keyboard-nav"
import {
  testNotification,
  useLastNotification,
} from "@/hooks/use-pr-notifications"
import { formatUntil, pause, resume, useQuiet } from "@/hooks/use-quiet"
import { resetSeen } from "@/hooks/use-seen"
import { useTheme, type ThemeMode } from "@/hooks/use-theme"
import { Login } from "@/components/login"
import {
  Feedback,
  Row,
  Section,
  Segmented,
  Toggle,
  useConfirm,
  useFlash,
} from "@/components/settings-ui"
import { GITHUB, type Account } from "@/lib/accounts"
import { accountAdded, refreshPrs, signOut } from "@/lib/actions"
import { CLIENT_ID, forgetTokens, useAuth } from "@/lib/auth"
import {
  clearCache,
  reposWithMyOpenPrs,
  viewerProfile,
  type Profile,
} from "@/lib/github"
import { currentLang, locale, strings, useStrings, type Lang } from "@/lib/i18n"
import { reducedMotion } from "@/lib/motion"
import { openExternal } from "@/lib/open"
import { invoke, isWeb } from "@/lib/platform"
import {
  dropSnapshots,
  LOW,
  resetTime,
  useAutoInterval,
  useQuota,
} from "@/lib/quota"
import { parseHm, systemZone } from "@/lib/quiet"
import { resetSettings, updateSettings, useSettings } from "@/lib/settings"
import { checkForUpdate, installUpdate, useUpdate } from "@/lib/updater"
import { getRepos, reload, setRepos } from "@/lib/store"
import {
  connectSlack,
  disconnectSlack,
  forceRefreshMentions,
  listConversations,
  useSlack,
  useSlackProgress,
} from "@/lib/slack"
import type { SlackConversation } from "@/lib/types"

const SECTIONS = [
  "compte",
  "slack",
  "apparence",
  "actualisation",
  "notifications",
  "affichage",
  "repos",
  "donnees",
  "web",
  "raccourcis",
  "a-propos",
] as const

/** Sections masquées dans la version web (navigateur) : elles pilotent l'app elle-même. */
const DESKTOP_ONLY: readonly string[] = ["web"]
const SHOWN = SECTIONS.filter((id) => !(isWeb && DESKTOP_ONLY.includes(id)))

const S = strings(
  {
    sections: {
      compte: "Compte",
      slack: "Slack",
      apparence: "Apparence",
      actualisation: "Actualisation",
      notifications: "Notifications",
      affichage: "Affichage des PR",
      repos: "Repos suivis",
      donnees: "Données",
      web: "Version web",
      raccourcis: "Raccourcis clavier",
      "a-propos": "À propos",
    },
    failed: "Échec",
    account: {
      description:
        "Les comptes GitHub (github.com ou Enterprise) dont les PR sont affichées ensemble.",
      add: "Ajouter un compte",
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
    slack: {
      description:
        "Repère les PR dont le lien a déjà été posté sur Slack (badge sur la carte). Un seul workspace.",
      workspace: "Workspace",
      notConnected: "Non connecté",
      connect: "Connecter Slack",
      reconnect: "Reconnecter Slack",
      waiting: "En attente de Slack…",
      expired: "Session expirée",
      timeout: "Délai dépassé, recommence la connexion.",
      disconnect: "Déconnecter",
      mentions: "Mentions",
      refresh: "Actualiser",
      progress: (done: number, total: number) => `${done}/${total} PR`,
      refreshed: "Mentions relues",
      none: "Aucune PR lue pour l'instant.",
      next: (time: string) =>
        `Relecture auto : dès ${time}, à la prochaine actualisation GitHub.`,
      privacy:
        "Lecture seule, jetons dans le trousseau du système, messages lus uniquement sur ta machine. Ton admin Slack peut devoir approuver l'app : Slack propose alors de demander l'installation.",
      all: "Toutes les conversations (actuelles et futures)",
      allDescription:
        "Sinon, coche les conversations à surveiller. Rien de coché : fonctionnalité inactive.",
      filter: "Filtrer les conversations",
      loading: "Chargement des conversations…",
      kinds: {
        public: "public",
        private: "privé",
        im: "DM",
        mpim: "DM de groupe",
      },
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
      auto: (min: number) => `Auto · ${min} min`,
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
      launch: "Lancer à l'ouverture de session",
      launchDescription:
        "PR Radar démarre avec la session, pour ne manquer aucune notification.",
      launchError: (message: string) =>
        `Réglage du système impossible : ${message}`,
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
      reviewRequested: "Review demandée",
      drafts: "PR brouillon",
      draftsDescription: "Notifier aussi les changements des PR en brouillon.",
      dnd: "Ne pas déranger",
      dndOff:
        "Met en pause les notifications de PR Radar (le test passe toujours).",
      dndUntil: (until: string) => `En pause jusqu'à ${until}`,
      pauseHour: "1 heure",
      pauseTomorrow: "Jusqu'à demain",
      resume: "Reprendre",
      quietHours: "Plage quotidienne",
      quietHoursDescription:
        "Aucune notification chaque jour entre ces heures (peut passer minuit).",
      quietStart: "Début de la plage",
      quietEnd: "Fin de la plage",
      timeZone: "Fuseau horaire",
      timeZoneDescription: "Heures de la plage et de « Jusqu'à demain » (8 h).",
      systemZone: (zone: string) => `Système (${zone})`,
      focus: "Modes Concentration",
      focusDescription:
        "Un mode Concentration de macOS coupe déjà les notifications de PR Radar, sauf si l'app y est autorisée.",
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
      closeSettings: "fermer les réglages",
    },
    about: {
      description:
        "Gratuit, open source (MIT), fourni tel quel, sans garantie. Aucun serveur : l'app parle directement à GitHub, à votre serveur GitHub Enterprise si vous en ajoutez un, et à Slack si vous le connectez. Pendant la connexion Slack, le code à usage unique passe brièvement par une page statique du site, qui ne garde rien ; il est inutilisable sans la clé gardée dans l'app. Non affilié à GitHub ni à Slack.",
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
      privacy: "Confidentialité",
      licenses: "Licences tierces",
    },
    web: {
      description:
        "PR Radar dans un onglet du navigateur, servi par l'app sur cette machine uniquement.",
      settings: "Réglages de la version web",
      settingsDescription: "Activation, port et sessions des navigateurs.",
      open: "Ouvrir",
    },
    nav: "Sections des réglages",
    back: "Retour",
  },
  {
    sections: {
      compte: "Account",
      slack: "Slack",
      apparence: "Appearance",
      actualisation: "Refresh",
      notifications: "Notifications",
      affichage: "PR display",
      repos: "Tracked repos",
      donnees: "Data",
      web: "Web version",
      raccourcis: "Keyboard shortcuts",
      "a-propos": "About",
    },
    failed: "Failed",
    account: {
      description:
        "The GitHub accounts (github.com or Enterprise) whose PRs are shown together.",
      add: "Add an account",
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
    slack: {
      description:
        "Spots PRs whose link was already posted on Slack (badge on the card). One workspace.",
      workspace: "Workspace",
      notConnected: "Not connected",
      connect: "Connect Slack",
      reconnect: "Reconnect Slack",
      waiting: "Waiting for Slack…",
      expired: "Session expired",
      timeout: "Timed out, start the sign-in again.",
      disconnect: "Disconnect",
      mentions: "Mentions",
      refresh: "Refresh",
      progress: (done: number, total: number) =>
        `${done}/${total} PR${total > 1 ? "s" : ""}`,
      refreshed: "Mentions re-read",
      none: "No PR read yet.",
      next: (time: string) =>
        `Auto re-read: from ${time}, on the next GitHub refresh.`,
      privacy:
        "Read-only, tokens in the system keychain, messages read on your machine only. Your Slack admin may have to approve the app: Slack then offers to request the install.",
      all: "All conversations (current and future)",
      allDescription:
        "Otherwise, check the conversations to watch. Nothing checked: feature off.",
      filter: "Filter conversations",
      loading: "Loading conversations…",
      kinds: {
        public: "public",
        private: "private",
        im: "DM",
        mpim: "group DM",
      },
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
      auto: (min: number) => `Auto · ${min} min`,
      onFocus: "Refresh when returning to the window",
      quota: "GitHub quota",
      quotaDescription: "GraphQL points per hour. Notifies below 10% left.",
      quotaMeter: "GitHub quota remaining",
      quotaLine: (remaining: string, limit: string, reset: string) =>
        `${remaining} / ${limit} left · resets at ${reset}`,
      quotaUnknown: "Unknown until the first refresh",
      reloadAll: "Reload everything now",
      reloadNow: "Refresh now",
      launch: "Launch at login",
      launchDescription:
        "PR Radar starts with your session, so no notification is missed.",
      launchError: (message: string) =>
        `Could not change the system setting: ${message}`,
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
      reviewRequested: "Review requested",
      drafts: "Draft PRs",
      draftsDescription: "Also notify about changes on draft PRs.",
      dnd: "Do not disturb",
      dndOff: "Pauses PR Radar notifications (the test still goes through).",
      dndUntil: (until: string) => `Paused until ${until}`,
      pauseHour: "1 hour",
      pauseTomorrow: "Until tomorrow",
      resume: "Resume",
      quietHours: "Daily quiet hours",
      quietHoursDescription:
        "No notification every day between these times (may cross midnight).",
      quietStart: "Quiet hours start",
      quietEnd: "Quiet hours end",
      timeZone: "Time zone",
      timeZoneDescription: "Used for quiet hours and “Until tomorrow” (8 AM).",
      systemZone: (zone: string) => `System (${zone})`,
      focus: "Focus modes",
      focusDescription:
        "A macOS Focus already silences PR Radar notifications unless the app is allowed in that Focus.",
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
      closeSettings: "close settings",
    },
    about: {
      description:
        "Free, open source (MIT), provided as is, without warranty. No server: the app talks directly to GitHub, to your GitHub Enterprise server if you add one, and to Slack if you connect it. During Slack sign-in, the one-time code briefly passes through a static page of the website, which stores nothing; it is unusable without the key kept in the app. Not affiliated with GitHub or Slack.",
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
      privacy: "Privacy",
      licenses: "Third-party licenses",
    },
    web: {
      description:
        "PR Radar in a browser tab, served by the app on this machine only.",
      settings: "Web version settings",
      settingsDescription: "On/off, port and browser sessions.",
      open: "Open",
    },
    nav: "Settings sections",
    back: "Back",
  },
)

/** durée de la coche après une relecture forcée des mentions */
const CHECK_MS = 1_500
const DOWNLOAD_URL = "https://vlor999.github.io/pr-radar/"
const REPO_URL = "https://github.com/Vlor999/pr-radar"

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.matches("input, textarea, select") || t.isContentEditable)

/* ---------- Sections ---------- */

function AccountSection() {
  const t = useStrings(S)
  const { accounts } = useAuth()
  const [adding, setAdding] = useState(false)
  return (
    <Section
      id="compte"
      title={t.sections.compte}
      description={t.account.description}
    >
      {accounts.map((a) => (
        <AccountRows key={a.id} account={a} />
      ))}
      {/* version web : comptes ajoutés dans l'app */}
      {!isWeb && (
        <div className="border-t py-3">
          {adding ? (
            <Login
              onDone={(id) => {
                setAdding(false)
                if (id) void accountAdded(id)
              }}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" />
              {t.account.add}
            </Button>
          )}
        </div>
      )}
    </Section>
  )
}

function AccountRows({ account }: { account: Account }) {
  const t = useStrings(S)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState(false)
  const { source, host } = account
  useEffect(() => {
    viewerProfile(account).then(setProfile, () => setError(true))
  }, [account])
  const manageUrl =
    source === "oauth"
      ? `https://github.com/settings/connections/applications/${CLIENT_ID}`
      : source === "pat"
        ? `https://${host}/settings/tokens`
        : null
  return (
    <div className="border-t first:border-t-0">
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
                {host !== GITHUB && ` · ${host}`}
              </a>
            </div>
          </>
        ) : error ? (
          <p className="text-sm text-destructive">
            {t.account.profileError}
            {host !== GITHUB && ` (${host})`}
          </p>
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
        {!isWeb && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => void signOut(account.id)}
          >
            <LogOut data-icon="inline-start" />
            {t.account.logout}
          </Button>
        )}
      </Row>
    </div>
  )
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function SlackSection() {
  const t = useStrings(S)
  const { team, expired, error: searchError } = useSlack()
  const { slackAll, slackChannels } = useSettings()
  const progress = useSlackProgress()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [convs, setConvs] = useState<SlackConversation[] | null>(null)
  const [query, setQuery] = useState("")
  const live = !!team && !expired
  useEffect(() => {
    if (!live || slackAll || convs) return
    setError("")
    // DM d'abord affichés avec l'id du destinataire, puis avec son nom
    listConversations(setConvs).then(setConvs, (e: unknown) =>
      setError(message(e)),
    )
  }, [live, slackAll, convs])

  const connect = async () => {
    setBusy(true)
    setError("")
    try {
      await connectSlack()
      setConvs(null)
    } catch (e) {
      setError(e === "timeout" ? t.slack.timeout : message(e))
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id: string, on: boolean) =>
    updateSettings({
      slackChannels: on
        ? [...slackChannels, id]
        : slackChannels.filter((c) => c !== id),
    })
  const shown = convs?.filter((c) =>
    c.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <Section
      id="slack"
      title={t.sections.slack}
      description={t.slack.description}
    >
      <>
        <Row
          label={t.slack.workspace}
          description={
            <>
              {team ? (
                <span className={cn(expired && "text-destructive")}>
                  {team.name}
                  {expired && ` · ${t.slack.expired}`}
                </span>
              ) : (
                t.slack.notConnected
              )}
              <br />
              {t.slack.privacy}
            </>
          }
        >
          {!isWeb && (!team || expired) && (
            <Button variant="outline" size="sm" onClick={() => void connect()}>
              {busy && (
                <Loader2
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                />
              )}
              {busy
                ? t.slack.waiting
                : team
                  ? t.slack.reconnect
                  : t.slack.connect}
            </Button>
          )}
          {!isWeb && team && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => void disconnectSlack().then(() => setConvs(null))}
            >
              <LogOut data-icon="inline-start" />
              {t.slack.disconnect}
            </Button>
          )}
        </Row>
        {(error || searchError) && (
          <p className="pb-3 text-xs text-destructive">
            {error || searchError}
          </p>
        )}
        {live && (
          <Row
            label={t.slack.mentions}
            description={
              progress.nextAt
                ? t.slack.next(
                    new Date(progress.nextAt).toLocaleTimeString(locale(), {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  )
                : t.slack.none
            }
          >
            <SlackRefreshButton
              label={t.slack.refresh}
              progress={t.slack.progress}
              refreshed={t.slack.refreshed}
            />
          </Row>
        )}
        {live && (
          <Row
            label={t.slack.all}
            labelId="slack-all-label"
            description={t.slack.allDescription}
          >
            <Toggle
              checked={slackAll}
              onChange={(v) => updateSettings({ slackAll: v })}
              labelledBy="slack-all-label"
            />
          </Row>
        )}
        {live && !slackAll && (
          <div className="flex flex-col gap-2 border-t py-3">
            {!shown ? (
              !error && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                  {t.slack.loading}
                </p>
              )
            ) : (
              <>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.slack.filter}
                  aria-label={t.slack.filter}
                  className="max-w-64"
                />
                <ul className="flex max-h-64 flex-col overflow-y-auto">
                  {shown.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted">
                        <input
                          type="checkbox"
                          checked={slackChannels.includes(c.id)}
                          onChange={(e) => toggle(c.id, e.target.checked)}
                          className="accent-primary"
                        />
                        <span className="min-w-0 truncate">
                          {c.kind === "public" || c.kind === "private"
                            ? `#${c.name}`
                            : c.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t.slack.kinds[c.kind]}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </>
    </Section>
  )
}

/** Relecture des mentions : le bouton se remplit (n/total), puis une coche s'affiche 1,5 s après une lecture complète. */
function SlackRefreshButton(props: {
  label: string
  progress: (done: number, total: number) => string
  refreshed: string
}) {
  const { running, done, total, known, completedAt } = useSlackProgress()
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    const wait = (completedAt ?? 0) + CHECK_MS - Date.now()
    if (wait <= 0) return
    setChecked(true)
    const id = window.setTimeout(() => setChecked(false), wait)
    return () => window.clearTimeout(id)
  }, [completedAt])

  // une nouvelle lecture efface la coche
  const finished = checked && !running
  const shown = running || finished
  const text = props.progress(done, total)
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!known || shown}
        aria-busy={running}
        onClick={forceRefreshMentions}
        className={cn(
          "relative overflow-hidden tabular-nums",
          shown && "disabled:opacity-100",
        )}
      >
        {shown && (
          <span
            className="absolute inset-y-0 left-0 bg-primary/20 transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        )}
        {finished ? (
          <Check
            data-icon="inline-start"
            className="relative text-green-600 animate-in zoom-in-50 fade-in duration-300 motion-reduce:animate-none dark:text-green-400"
          />
        ) : (
          <RefreshCw
            data-icon="inline-start"
            className={cn(
              "relative",
              running && "animate-spin motion-reduce:animate-none",
            )}
          />
        )}
        <span className="relative">{shown ? text : props.label}</span>
      </Button>
      <span className="sr-only" aria-live="polite">
        {running ? text : finished ? props.refreshed : ""}
      </span>
    </>
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
  const autoMs = useAutoInterval()
  const t = useStrings(S)
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setBusy(true)
    await refreshPrs().finally(() => setBusy(false))
  }
  return (
    <Section
      id="actualisation"
      title={t.sections.actualisation}
      description={t.refresh.description}
    >
      {!isWeb && <LaunchAtLoginRow />}
      <Row label={t.refresh.frequency} labelId="refresh-label">
        {/* appearance-none : sinon le navigateur impose son propre style (pilule sombre) */}
        <div className="relative">
          <select
            aria-labelledby="refresh-label"
            value={s.refreshMinutes}
            onChange={(e) => {
              if (e.target.value === "auto") dropSnapshots()
              updateSettings({
                refreshMinutes:
                  e.target.value === "auto" ? "auto" : Number(e.target.value),
              })
            }}
            className="h-8 appearance-none rounded-lg border bg-background pr-7 pl-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            {(["auto", 0, 1, 2, 5, 10, 15, 30] as const).map((m) => (
              <option key={m} value={m}>
                {m === "auto"
                  ? t.refresh.auto(Math.round(autoMs / 60_000))
                  : m === 0
                    ? t.refresh.manual
                    : `${m} min`}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
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

const NOTIFY = [
  "approved",
  "changesRequested",
  "comments",
  "ciFailed",
  "reviewRequested",
] as const

const IS_MAC = navigator.userAgent.includes("Mac")
/** fuseaux IANA connus du moteur JS (choix du fuseau de la plage quotidienne) */
const TIME_ZONES = Intl.supportedValuesOf("timeZone")

// sur ordinateur, c'est le système qui autorise ou bloque : on renvoie vers ses réglages
const SYSTEM_NOTIFICATION_SETTINGS = IS_MAC
  ? "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
  : navigator.userAgent.includes("Windows")
    ? "ms-settings:notifications"
    : null

/** Lancement à l'ouverture de session : l'état est celui du système, relu en revenant sur la fenêtre. */
function LaunchAtLoginRow() {
  const t = useStrings(S)
  const [on, setOn] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const read = () =>
    isAutostartEnabled().then(setOn, (e: unknown) => setError(String(e)))
  useEffect(() => {
    void read()
    const onFocus = () => void read()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])
  const change = (v: boolean) => {
    setError(null)
    ;(v ? enableAutostart() : disableAutostart())
      .catch((e: unknown) => setError(String(e)))
      .finally(() => void read())
  }
  return (
    <Row
      label={t.refresh.launch}
      description={
        error ? t.refresh.launchError(error) : t.refresh.launchDescription
      }
      labelId="launch-label"
    >
      {on !== null && (
        <Toggle labelledBy="launch-label" checked={on} onChange={change} />
      )}
    </Row>
  )
}

/** « Ne pas déranger » : pause manuelle (1 h, jusqu'à demain) et plage quotidienne. */
function DoNotDisturbRows() {
  const s = useSettings()
  const t = useStrings(S)
  const quiet = useQuiet()
  const setHours = (patch: Partial<typeof s.quietHours>) =>
    updateSettings({ quietHours: { ...s.quietHours, ...patch } })
  const time = (
    id: string,
    label: string,
    value: string,
    key: "start" | "end",
  ) => (
    <input
      id={id}
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => {
        if (parseHm(e.target.value) !== null)
          setHours({ [key]: e.target.value })
      }}
      className="h-8 rounded-lg border bg-background px-2 text-sm tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    />
  )
  return (
    <>
      <Row
        label={t.notifications.dnd}
        description={
          quiet.until
            ? t.notifications.dndUntil(formatUntil(quiet.until, quiet.zone))
            : t.notifications.dndOff
        }
      >
        {quiet.manual ? (
          <Button variant="outline" size="sm" onClick={resume}>
            {t.notifications.resume}
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => pause("hour")}>
              {t.notifications.pauseHour}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pause("tomorrow")}
            >
              {t.notifications.pauseTomorrow}
            </Button>
          </>
        )}
      </Row>
      <Row
        label={t.notifications.quietHours}
        description={t.notifications.quietHoursDescription}
        labelId="quiet-hours"
      >
        {time(
          "quiet-start",
          t.notifications.quietStart,
          s.quietHours.start,
          "start",
        )}
        <span className="text-muted-foreground">–</span>
        {time("quiet-end", t.notifications.quietEnd, s.quietHours.end, "end")}
        <Toggle
          labelledBy="quiet-hours"
          checked={s.quietHours.enabled}
          onChange={(enabled) => setHours({ enabled })}
        />
      </Row>
      <Row
        label={t.notifications.timeZone}
        description={t.notifications.timeZoneDescription}
        labelId="quiet-zone"
      >
        <div className="relative">
          <select
            aria-labelledby="quiet-zone"
            value={s.quietTimeZone ?? ""}
            onChange={(e) =>
              updateSettings({ quietTimeZone: e.target.value || null })
            }
            className="h-8 max-w-64 appearance-none rounded-lg border bg-background pr-7 pl-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <option value="">{t.notifications.systemZone(systemZone())}</option>
            {/* fuseau partagé que ce moteur ne liste pas (ex. "UTC") : ajouté pour rester affiché */}
            {(s.quietTimeZone && !TIME_ZONES.includes(s.quietTimeZone)
              ? [s.quietTimeZone, ...TIME_ZONES]
              : TIME_ZONES
            ).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
      </Row>
    </>
  )
}

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
      {/* version web : les notifications partent de l'app, pas de l'onglet */}
      {!isWeb && (
        <>
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
        </>
      )}
      {!isWeb && SYSTEM_NOTIFICATION_SETTINGS && (
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
      {!isWeb && IS_MAC && (
        <Row
          label={t.notifications.focus}
          description={t.notifications.focusDescription}
        />
      )}
      <DoNotDisturbRows />
      {NOTIFY.map((key) => (
        <Row key={key} label={t.notifications[key]} labelId={`notify-${key}`}>
          <Toggle
            labelledBy={`notify-${key}`}
            checked={s.notify[key]}
            onChange={(v) => updateSettings({ notify: { [key]: v } })}
          />
        </Row>
      ))}
      <Row
        label={t.notifications.drafts}
        description={t.notifications.draftsDescription}
        labelId="notify-drafts"
      >
        <Toggle
          labelledBy="notify-drafts"
          checked={s.notifyDrafts}
          onChange={(v) => updateSettings({ notifyDrafts: v })}
        />
      </Row>
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
      {!isWeb && <UninstallRow />}
    </Section>
  )
}

/** Version web : réglages sur leur propre page (src/components/web-page.tsx). */
function WebSection({ onOpen }: { onOpen: () => void }) {
  const t = useStrings(S)
  return (
    <Section id="web" title={t.sections.web} description={t.web.description}>
      <Row label={t.web.settings} description={t.web.settingsDescription}>
        <Button variant="outline" size="sm" onClick={onOpen}>
          {t.web.open}
          <ChevronRight data-icon="inline-end" />
        </Button>
      </Row>
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
    { keys: ["mod", ","], label: t.shortcuts.openSettings },
    { keys: ["esc"], label: t.shortcuts.closeSettings },
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
            <tr key={r.label} className="border-t first:border-t-0">
              <td className="w-28 py-2">
                <Shortcut keys={r.keys} />
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
        {/* version web : les mises à jour se font dans l'app */}
        {isWeb ? null : update.status === "available" ? (
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
      {/* label above: the five links do not fit on one line next to it in French */}
      <div className="border-t py-3">
        <div className="text-sm font-medium">{t.about.links}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {[
            [t.about.source, REPO_URL],
            [t.about.download, DOWNLOAD_URL],
            [t.about.report, `${REPO_URL}/issues/new`],
            [t.about.privacy, `${DOWNLOAD_URL}#privacy`],
            // the notices of this exact version (release tags are vX.Y.Z)
            [
              t.about.licenses,
              `${REPO_URL}/blob/${version ? `v${version}` : "main"}/THIRD_PARTY_NOTICES.md`,
            ],
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
        </div>
      </div>
    </Section>
  )
}

/* ---------- Page ---------- */

export function SettingsPage({
  onClose,
  onOpenWeb,
}: {
  onClose: () => void
  /** page de la version web */
  onOpenWeb: () => void
}) {
  const t = useStrings(S)
  const [active, setActive] = useState<string>(SHOWN[0])

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
    SHOWN.forEach((id) => {
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
          {SHOWN.map((id) => (
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
        <SlackSection />
        <AppearanceSection />
        <RefreshSection />
        <NotificationsSection />
        <DisplaySection />
        <ReposSection />
        <DataSection />
        {!isWeb && <WebSection onOpen={onOpenWeb} />}
        <ShortcutsSection />
        <AboutSection />
      </div>
    </div>
  )
}
