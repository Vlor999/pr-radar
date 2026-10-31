import { getVersion } from "@tauri-apps/api/app"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import { cn } from "cn"
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronDown,
  Coffee,
  ExternalLink,
  GitPullRequest,
  Globe,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IS_MAC, Shortcut } from "@/components/shortcut"
import { SHORTCUTS } from "@/hooks/use-keyboard-nav"
import {
  testNotification,
  useLastNotification,
} from "@/hooks/use-pr-notifications"
import { formatUntil, pause, resume, useQuiet } from "@/hooks/use-quiet"
import { resetSeen } from "@/hooks/use-seen"
import { useTheme, type ThemeMode } from "@/hooks/use-theme"
import { Login } from "@/components/login"
import { CLIENT_LABEL, MCP_STRINGS, McpCategory } from "@/components/mcp-page"
import {
  Feedback,
  Row,
  Section,
  Segmented,
  settingDomId,
  Toggle,
  useConfirm,
  useFlash,
} from "@/components/settings-ui"
import { WEB_STRINGS, WebCategory } from "@/components/web-page"
import { GITHUB, type Account } from "@/lib/accounts"
import { accountAdded, refreshPrs, signOut } from "@/lib/actions"
import { CLIENT_ID, forgetTokens, useAuth } from "@/lib/auth"
import { BUY_ME_A_COFFEE_URL, SETTING_HIGHLIGHT_MS } from "@/lib/constants"
import {
  clearCache,
  reposWithMyOpenPrs,
  viewerProfile,
  type Profile,
} from "@/lib/github"
import { currentLang, locale, strings, useStrings, type Lang } from "@/lib/i18n"
import { useMcp } from "@/lib/mcp"
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
import { MINUTE_MS, parseHm, systemZone } from "@/lib/quiet"
import { resetSettings, updateSettings, useSettings } from "@/lib/settings"
import {
  flatResults,
  searchSettings,
  type SettingEntry,
} from "@/lib/settings-search"
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

const CATEGORIES = [
  "general",
  "accounts",
  "notifications",
  "prs",
  "mcp",
  "web",
  "advanced",
] as const

export type SettingsCategory = (typeof CATEGORIES)[number]
type Category = SettingsCategory

const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  general: Settings2,
  accounts: Users,
  notifications: Bell,
  prs: GitPullRequest,
  mcp: Plug,
  web: Globe,
  advanced: SlidersHorizontal,
}

/** Réglages masqués dans la version web (navigateur) : ils pilotent l'app elle-même. */
const DESKTOP_ONLY: readonly string[] = [
  "launch",
  "last",
  "test",
  "system",
  "focus",
  "uninstall",
]

const S = strings(
  {
    categories: {
      general: "Général",
      accounts: "Comptes",
      notifications: "Notifications",
      prs: "PR et repos",
      mcp: "Serveur MCP",
      web: "Version web",
      advanced: "Avancé",
    },
    sections: {
      app: "Application",
      shortcuts: "Raccourcis clavier",
      about: "À propos",
      accounts: "Comptes GitHub",
      slack: "Slack",
      when: "Quand notifier",
      pause: "Pause",
      troubleshoot: "Dépannage",
      display: "Affichage des PR",
      repos: "Repos suivis",
      refresh: "Actualisation",
      github: "API GitHub",
      data: "Données",
      danger: "Zone sensible",
    },
    app: { description: "Thème, langue et démarrage." },
    pause: {
      description: "Coupe les notifications un moment ou chaque jour.",
    },
    troubleshoot: {
      description:
        "Rien ne s'affiche ? Teste l'envoi et vérifie les réglages du système.",
    },
    github: { description: "Quota de l'API et relecture complète." },
    danger: { description: "Ces actions effacent tes réglages ou l'app." },
    search: {
      placeholder: "Rechercher un réglage",
      count: (n: number) => `${n} résultat${n > 1 ? "s" : ""}`,
      others: "Autres catégories",
      empty: "Aucun réglage trouvé",
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
      searchSettings: "rechercher un réglage",
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
      support: "Soutenir PR Radar",
      supportDescription:
        "Gratuit et sans publicité. Un café aide à le faire vivre.",
      coffee: "Offrir un café",
      links: "Liens",
      source: "Code source",
      download: "Page de téléchargement",
      report: "Signaler un problème",
      privacy: "Confidentialité",
      licenses: "Licences tierces",
    },
    nav: "Catégories des réglages",
    back: "Retour",
  },
  {
    categories: {
      general: "General",
      accounts: "Accounts",
      notifications: "Notifications",
      prs: "PRs and repos",
      mcp: "MCP server",
      web: "Web version",
      advanced: "Advanced",
    },
    sections: {
      app: "App",
      shortcuts: "Keyboard shortcuts",
      about: "About",
      accounts: "GitHub accounts",
      slack: "Slack",
      when: "When to notify",
      pause: "Pause",
      troubleshoot: "Troubleshooting",
      display: "PR display",
      repos: "Tracked repos",
      refresh: "Refresh",
      github: "GitHub API",
      data: "Data",
      danger: "Danger zone",
    },
    app: { description: "Theme, language and startup." },
    pause: {
      description: "Silences notifications for a while or every day.",
    },
    troubleshoot: {
      description:
        "Nothing shows up? Send a test and check the system settings.",
    },
    github: { description: "API quota and full reload." },
    danger: { description: "These actions erase your settings or the app." },
    search: {
      placeholder: "Search settings",
      count: (n: number) => `${n} result${n > 1 ? "s" : ""}`,
      others: "Other categories",
      empty: "No setting found",
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
      searchSettings: "search settings",
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
      support: "Support PR Radar",
      supportDescription: "Free and ad-free. A coffee helps keep it going.",
      coffee: "Buy me a coffee",
      links: "Links",
      source: "Source code",
      download: "Download page",
      report: "Report an issue",
      privacy: "Privacy",
      licenses: "Third-party licenses",
    },
    nav: "Settings categories",
    back: "Back",
  },
)

/** durée de la coche après une relecture forcée des mentions */
const CHECK_MS = 1_500
const DOWNLOAD_URL = "https://vlor999.github.io/pr-radar/"
const REPO_URL = "https://github.com/Vlor999/pr-radar"

const NOTIFY = [
  "approved",
  "changesRequested",
  "comments",
  "ciFailed",
  "reviewRequested",
] as const

/** fuseaux IANA connus du moteur JS (choix du fuseau de la plage quotidienne) */
const TIME_ZONES = Intl.supportedValuesOf("timeZone")

// sur ordinateur, c'est le système qui autorise ou bloque : on renvoie vers ses réglages
const SYSTEM_NOTIFICATION_SETTINGS = IS_MAC
  ? "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
  : navigator.userAgent.includes("Windows")
    ? "ms-settings:notifications"
    : null

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
      id={settingDomId("accounts")}
      title={t.sections.accounts}
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
          id="slack"
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

function AppSection() {
  const { theme, setTheme } = useTheme()
  const { lang } = useSettings()
  const t = useStrings(S)
  return (
    <Section id="app" title={t.sections.app} description={t.app.description}>
      <Row
        id="theme"
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
      <Row id="lang" label="Langue · Language" labelId="lang-label">
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
      {!isWeb && <LaunchAtLoginRow />}
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
      id="launch"
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
        id="dnd"
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
        id="quiet-hours"
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
        id="time-zone"
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

type TestState =
  { state: "sending" | "sent" } | { state: "error"; message: string } | null

/** Notifications : état en tête, quand notifier, pause, puis dépannage replié. */
function NotificationsCategory(props: {
  troubleshootOpen: boolean
  onTroubleshootOpen: (open: boolean) => void
}) {
  const s = useSettings()
  const last = useLastNotification()
  const t = useStrings(S)
  const [test, setTest] = useState<TestState>(null)
  const send = () => {
    setTest({ state: "sending" })
    testNotification().then(
      () => setTest({ state: "sent" }),
      (e: unknown) => setTest({ state: "error", message: String(e) }),
    )
  }
  const feedback =
    test?.state === "sent"
      ? t.notifications.sent
      : test?.state === "error"
        ? t.notifications.error(test.message)
        : null
  const testButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={test?.state === "sending"}
      onClick={send}
    >
      {t.notifications.sendTest}
    </Button>
  )
  return (
    <>
      {/* version web : les notifications partent de l'app, pas de l'onglet */}
      {!isWeb && (
        <div
          id={settingDomId("last")}
          className="flex scroll-mt-24 outline-none flex-col gap-2 rounded-2xl border bg-card px-4 py-3 transition-colors duration-500 data-[highlight]:bg-primary/10 motion-reduce:transition-none sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div className="min-w-0 text-sm">
            <span className="font-medium">{t.notifications.last}</span>
            <span className="text-muted-foreground">
              {" · "}
              {last
                ? `${last.title} · ${new Date(last.at).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" })}`
                : t.notifications.none}
            </span>
            {feedback && (
              <p
                aria-live="polite"
                className="mt-0.5 text-xs text-muted-foreground"
              >
                {feedback}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={test?.state === "sending"}
            onClick={send}
          >
            {t.notifications.test}
          </Button>
        </div>
      )}
      <Section
        id="when"
        title={t.sections.when}
        description={t.notifications.description}
      >
        <div className="grid gap-x-6 py-1 sm:grid-cols-2">
          {NOTIFY.map((key) => (
            <div
              key={key}
              id={settingDomId(key)}
              className="-mx-2 flex scroll-mt-24 outline-none items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors duration-500 data-[highlight]:bg-primary/10 motion-reduce:transition-none"
            >
              <span id={`notify-${key}`} className="text-sm font-medium">
                {t.notifications[key]}
              </span>
              <Toggle
                labelledBy={`notify-${key}`}
                checked={s.notify[key]}
                onChange={(v) => updateSettings({ notify: { [key]: v } })}
              />
            </div>
          ))}
        </div>
        <Row
          id="drafts"
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
      <Section
        id="pause"
        title={t.sections.pause}
        description={t.pause.description}
      >
        <DoNotDisturbRows />
      </Section>
      {!isWeb && (
        <Section
          id="troubleshoot"
          title={t.sections.troubleshoot}
          description={t.troubleshoot.description}
          open={props.troubleshootOpen}
          onOpenChange={props.onTroubleshootOpen}
        >
          <Row
            id="test"
            label={t.notifications.test}
            description={feedback ?? t.notifications.testHint}
          >
            {testButton}
          </Row>
          {SYSTEM_NOTIFICATION_SETTINGS && (
            <Row
              id="system"
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
          {IS_MAC && (
            <Row
              id="focus"
              label={t.notifications.focus}
              description={t.notifications.focusDescription}
            />
          )}
        </Section>
      )}
    </>
  )
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
    { keys: [["/"], ["mod", "F"]], label: t.shortcuts.searchSettings },
  ]
  return (
    <Section
      id={settingDomId("shortcuts")}
      title={t.sections.shortcuts}
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
      id="about"
      title={t.sections.about}
      description={t.about.description}
    >
      <Row id="version" label="PR Radar" description={t.about.version(version)}>
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
      <Row
        id="support"
        label={t.about.support}
        description={t.about.supportDescription}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => openExternal(BUY_ME_A_COFFEE_URL)}
        >
          <Coffee data-icon="inline-start" />
          {t.about.coffee}
        </Button>
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

/* ---------- Recherche ---------- */

type Entry = SettingEntry<Category> & {
  /** ligne dans le groupe repliable « Dépannage » */
  troubleshoot?: boolean
}

const words = (...parts: string[]) => parts.join(" ")

/** Index statique des réglages dans la langue affichée (l'id est celui de la ligne, `settingDomId`). */
function settingsIndex(
  t: (typeof S)["fr"],
  shortcuts: { label: string }[],
  mcp: (typeof MCP_STRINGS)["fr"],
  web: (typeof WEB_STRINGS)["fr"],
  available: (c: Category) => boolean,
): Entry[] {
  const n = t.notifications
  const entries: Entry[] = [
    {
      id: "theme",
      category: "general",
      label: t.appearance.theme,
      description: t.appearance.shortcut,
      keywords: words(t.appearance.light, t.appearance.dark, t.appearance.auto),
    },
    {
      id: "lang",
      category: "general",
      label: "Langue · Language",
      keywords: "français english",
    },
    {
      id: "launch",
      category: "general",
      label: t.refresh.launch,
      description: t.refresh.launchDescription,
    },
    {
      id: "shortcuts",
      category: "general",
      label: t.sections.shortcuts,
      description: t.shortcuts.description,
      keywords: words(...shortcuts.map((s) => s.label)),
    },
    {
      id: "version",
      category: "general",
      label: t.sections.about,
      description: t.about.version(null),
      keywords: words(
        "PR Radar",
        t.about.check,
        t.about.source,
        t.about.report,
        t.about.privacy,
        t.about.licenses,
      ),
    },
    {
      id: "support",
      category: "general",
      label: t.about.support,
      description: t.about.supportDescription,
      keywords: words(
        t.about.coffee,
        "buy me a coffee café coffee soutenir support don donate sponsor",
      ),
    },
    {
      id: "accounts",
      category: "accounts",
      label: t.sections.accounts,
      description: t.account.description,
      keywords: words(
        t.account.add,
        t.account.logout,
        t.account.manage,
        t.account.oauth,
        t.account.pat,
        t.account.gh,
      ),
    },
    {
      id: "slack",
      category: "accounts",
      label: t.sections.slack,
      description: t.slack.description,
      keywords: words(
        t.slack.connect,
        t.slack.disconnect,
        t.slack.mentions,
        t.slack.all,
      ),
    },
    {
      id: "last",
      category: "notifications",
      label: n.last,
      keywords: n.test,
    },
    ...NOTIFY.map((key): Entry => ({
      id: key,
      category: "notifications",
      label: n[key],
      keywords: t.sections.when,
    })),
    {
      id: "drafts",
      category: "notifications",
      label: n.drafts,
      description: n.draftsDescription,
    },
    {
      id: "dnd",
      category: "notifications",
      label: n.dnd,
      description: n.dndOff,
      keywords: words(t.sections.pause, n.pauseHour, n.pauseTomorrow),
    },
    {
      id: "quiet-hours",
      category: "notifications",
      label: n.quietHours,
      description: n.quietHoursDescription,
    },
    {
      id: "time-zone",
      category: "notifications",
      label: n.timeZone,
      description: n.timeZoneDescription,
    },
    {
      id: "test",
      category: "notifications",
      label: n.test,
      description: n.testHint,
      keywords: words(n.sendTest, t.sections.troubleshoot),
      troubleshoot: true,
    },
    ...(SYSTEM_NOTIFICATION_SETTINGS
      ? [
          {
            id: "system",
            category: "notifications",
            label: n.system,
            description: n.systemDescription,
            keywords: t.sections.troubleshoot,
            troubleshoot: true,
          } satisfies Entry,
        ]
      : []),
    ...(IS_MAC
      ? [
          {
            id: "focus",
            category: "notifications",
            label: n.focus,
            description: n.focusDescription,
            keywords: t.sections.troubleshoot,
            troubleshoot: true,
          } satisfies Entry,
        ]
      : []),
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
    {
      id: "mcp-server",
      category: "mcp",
      label: mcp.state.server,
      description: mcp.state.description,
      keywords: words(mcp.subtitle, mcp.state.socket, "agent"),
    },
    {
      id: "mcp-calls",
      category: "mcp",
      label: mcp.state.today,
    },
    {
      id: "mcp-client",
      category: "mcp",
      label: mcp.install.title,
      description: mcp.install.description,
      keywords: words(
        mcp.install.client,
        mcp.install.other,
        ...Object.values(CLIENT_LABEL),
      ),
    },
    {
      id: "mcp-tools",
      category: "mcp",
      label: mcp.tools.title,
      description: mcp.tools.description,
      keywords: "get_prs get_pr",
    },
    {
      id: "mcp-history",
      category: "mcp",
      label: mcp.history.title,
      description: mcp.history.description,
      keywords: mcp.history.clear,
    },
    {
      id: "web-enable",
      category: "web",
      label: web.enable,
      description: web.subtitle,
      keywords: words(web.title, web.server, web.open, "127.0.0.1"),
    },
    {
      id: "web-port",
      category: "web",
      label: web.port,
      description: web.portDescription,
    },
    {
      id: "web-sessions",
      category: "web",
      label: web.secret,
      description: web.secretDescription,
      keywords: web.rotate,
    },
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
      category: "advanced",
      label: t.uninstall.label,
      description: t.uninstall.description,
      keywords: t.sections.danger,
    },
  ]
  return entries.filter(
    (e) => available(e.category) && !(isWeb && DESKTOP_ONLY.includes(e.id)),
  )
}

function SearchResults(props: {
  results: ReturnType<typeof searchSettings<Category>>
  selected: string | undefined
  onSelect: (e: Entry) => void
  onHover: (id: string) => void
}) {
  const t = useStrings(S)
  const { results } = props
  const option = (e: Entry, withCategory: boolean) => (
    <li
      key={e.id}
      id={`settings-result-${e.id}`}
      role="option"
      aria-selected={props.selected === e.id}
      onClick={() => props.onSelect(e)}
      onMouseMove={() => props.onHover(e.id)}
      className={cn(
        "cursor-pointer border-t px-4 py-2.5 first:border-t-0",
        props.selected === e.id && "bg-muted",
      )}
    >
      <div className="text-sm font-medium">
        {e.label}
        {withCategory && e.troubleshoot && (
          <span className="font-normal text-muted-foreground">
            {" · "}
            {t.sections.troubleshoot}
          </span>
        )}
      </div>
      {e.description && (
        <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {e.description}
        </div>
      )}
    </li>
  )
  if (!results.count)
    return (
      <p
        aria-live="polite"
        className="py-8 text-center text-sm text-muted-foreground"
      >
        {t.search.empty}
      </p>
    )
  // listbox : seulement des groupes d'options ; compte annoncé à côté, intitulés visuels
  // aria-hidden et repris comme noms des groupes (aria-labelledby)
  return (
    <div className="flex flex-col gap-6">
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {t.search.count(results.count)}
      </p>
      <div
        id="settings-results"
        role="listbox"
        aria-label={t.search.count(results.count)}
        className="flex flex-col gap-6"
      >
        {results.current.length > 0 && (
          <div
            role="group"
            aria-label={t.categories[results.current[0].category]}
          >
            <ul
              role="presentation"
              className="overflow-hidden rounded-2xl border bg-card"
            >
              {results.current.map((e) => option(e, true))}
            </ul>
          </div>
        )}
        {results.others.length > 0 && (
          <div role="presentation" className="flex flex-col gap-3">
            <div
              id="settings-results-others"
              aria-hidden
              className="text-sm font-semibold text-muted-foreground"
            >
              {t.search.others}
            </div>
            {results.others.map((g) => (
              <div
                key={g.category}
                role="group"
                aria-labelledby={`settings-results-others settings-results-${g.category}`}
              >
                <div
                  id={`settings-results-${g.category}`}
                  aria-hidden
                  className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  {t.categories[g.category]}
                </div>
                <ul
                  role="presentation"
                  className="overflow-hidden rounded-2xl border bg-card"
                >
                  {g.entries.map((e) => option(e, true))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Page ---------- */

/**
 * Réglages plein écran. La catégorie affichée est tenue par le tableau de bord (pr-dashboard.tsx),
 * qui les ouvre directement sur « Serveur MCP » ou « Version web » depuis ses boutons et la palette.
 */
export function SettingsPage({
  category: requested,
  onCategory,
  onClose,
}: {
  category: Category
  onCategory: (c: Category) => void
  onClose: () => void
}) {
  const t = useStrings(S)
  const shortcuts = useStrings(SHORTCUTS)
  const mcpStrings = useStrings(MCP_STRINGS)
  const webStrings = useStrings(WEB_STRINGS)
  // mêmes conditions que les anciens points d'entrée : bouton MCP si le binaire le gère, version web dans l'app seulement
  const mcpInfo = useMcp().info
  const mcpSupported = !!mcpInfo?.supported
  const available = (c: Category) =>
    c === "mcp" ? mcpSupported : c === "web" ? !isWeb : true
  const category = available(requested) ? requested : "general"
  // catégorie indisponible pour de bon : le tableau de bord se recale sur Général. Infos MCP encore
  // en chargement (info null au lancement) : on garde « mcp » demandé, affiché dès qu'il est confirmé.
  const settled = requested !== "mcp" || mcpInfo !== null
  useEffect(() => {
    if (category !== requested && settled) onCategory(category)
  }, [category, requested, settled, onCategory])
  const [troubleshootOpen, setTroubleshootOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  /** réglage à montrer après le rendu de sa catégorie */
  const target = useRef<string | null>(null)
  const highlightTimer = useRef<number>(undefined)
  /** élément surligné en ce moment */
  const highlighted = useRef<HTMLElement | null>(null)
  const clearHighlight = () => {
    clearTimeout(highlightTimer.current)
    if (highlighted.current) delete highlighted.current.dataset.highlight
    highlighted.current = null
  }

  const index = useMemo(
    () => settingsIndex(t, shortcuts, mcpStrings, webStrings, available),
    // available ne dépend que de mcpSupported
    [t, shortcuts, mcpStrings, webStrings, mcpSupported],
  )
  const results = useMemo(
    () => searchSettings(index, query, category),
    [index, query, category],
  )
  const flat = flatResults(results)
  const searching = query.trim() !== ""
  const selected = flat[Math.min(cursor, flat.length - 1)]?.id

  useEffect(() => {
    const focusSearch = () => {
      search.current?.focus()
      search.current?.select()
    }
    const onKey = (e: KeyboardEvent) => {
      // palette de commandes ouverte : ses touches restent les siennes
      if (
        (e.target as HTMLElement | null)?.closest?.(
          "[data-slot=dialog-content]",
        )
      )
        return
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault()
        focusSearch()
        return
      }
      if (isTyping(e.target) || e.defaultPrevented) return
      if (e.key === "Escape") onClose()
      else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        focusSearch()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => () => clearTimeout(highlightTimer.current), [])

  // nouvelle catégorie (menu, bouton MCP, palette) : en haut de page ; le réglage cherché défile ensuite
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [category])

  // réglage choisi dans la recherche : défilement, focus sur sa commande, surlignage bref
  useEffect(() => {
    const id = target.current
    if (!id) return
    target.current = null
    const el = document.getElementById(settingDomId(id))
    if (!el) return
    el.scrollIntoView({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "center",
    })
    // focus sur la ligne elle-même (sans anneau, outline-none) : Tab mène ensuite à sa commande,
    // sans l'anneau focus-visible qu'un focus programmé sur le bouton affiche après Entrée
    el.tabIndex = -1
    el.focus({ preventScroll: true })
    // résultat précédent encore surligné (deux résultats à moins de SETTING_HIGHLIGHT_MS) : éteint d'abord
    clearHighlight()
    el.dataset.highlight = ""
    highlighted.current = el
    highlightTimer.current = window.setTimeout(
      clearHighlight,
      SETTING_HIGHLIGHT_MS,
    )
  })

  useEffect(() => {
    if (selected)
      document
        .getElementById(`settings-result-${selected}`)
        ?.scrollIntoView({ block: "nearest" })
  }, [selected])

  const open = (e: Entry) => {
    target.current = e.id
    if (e.troubleshoot) setTroubleshootOpen(true)
    setQuery("")
    setCursor(0)
    onCategory(e.category)
  }

  const go = (c: Category) => {
    setQuery("")
    onCategory(c)
  }

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!flat.length) return
      e.preventDefault()
      const i = Math.min(cursor, flat.length - 1)
      setCursor(
        e.key === "ArrowDown"
          ? Math.min(i + 1, flat.length - 1)
          : Math.max(i - 1, 0),
      )
    } else if (e.key === "Enter") {
      const hit = flat.find((r) => r.id === selected)
      if (hit) {
        e.preventDefault()
        open(hit)
      }
    } else if (e.key === "Escape") {
      // 1er Échap : vide la recherche ; 2e : quitte le champ (la page reste ouverte)
      if (query) setQuery("")
      else e.currentTarget.blur()
      setCursor(0)
    }
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
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 py-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:py-0">
          {CATEGORIES.filter(available).map((c) => {
            const Icon = CATEGORY_ICONS[c]
            return (
              <li key={c} className="shrink-0">
                {/* Avancé à part : réglages rarement touchés et zone sensible */}
                {c === "advanced" && (
                  <div
                    role="separator"
                    className="mx-3 my-2 hidden border-t md:block"
                  />
                )}
                <button
                  type="button"
                  onClick={() => go(c)}
                  aria-current={category === c ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none",
                    category === c
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {t.categories[c]}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="flex w-full max-w-2xl min-w-0 flex-col gap-8 pb-16">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={search}
            id="settings-search"
            type="search"
            role="combobox"
            aria-expanded={searching && results.count > 0}
            aria-controls={
              searching && results.count > 0 ? "settings-results" : undefined
            }
            aria-activedescendant={
              searching && selected ? `settings-result-${selected}` : undefined
            }
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onSearchKey}
            placeholder={t.search.placeholder}
            aria-label={t.search.placeholder}
            className="pr-16 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          <Shortcut
            keys={["/"]}
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2"
          />
        </div>
        {searching ? (
          <SearchResults
            results={results}
            selected={selected}
            onSelect={open}
            onHover={(id) => setCursor(flat.findIndex((r) => r.id === id))}
          />
        ) : (
          <>
            <h1 className="-mb-4 text-xl font-semibold">
              {t.categories[category]}
            </h1>
            {category === "general" && (
              <>
                <AppSection />
                <ShortcutsSection />
                <AboutSection />
              </>
            )}
            {category === "accounts" && (
              <>
                <AccountSection />
                <SlackSection />
              </>
            )}
            {category === "notifications" && (
              <NotificationsCategory
                troubleshootOpen={troubleshootOpen}
                onTroubleshootOpen={setTroubleshootOpen}
              />
            )}
            {category === "prs" && (
              <>
                <DisplaySection />
                <ReposSection />
                <RefreshSection />
              </>
            )}
            {category === "mcp" && <McpCategory />}
            {category === "web" && <WebCategory />}
            {category === "advanced" && (
              <>
                <GitHubSection />
                <DataSection />
                <DangerSection />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
