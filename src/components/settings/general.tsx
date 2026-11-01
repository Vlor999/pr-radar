import { getVersion } from "@tauri-apps/api/app"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import {
  Coffee,
  ExternalLink,
  Loader2,
  MessageSquare,
  Monitor,
  Moon,
  Sun,
} from "lucide-react"
import { useEffect, useState } from "react"

import { words, type SettingsEntry } from "@/components/settings/category"
import {
  Row,
  Section,
  Segmented,
  settingDomId,
  Toggle,
} from "@/components/settings/ui"
import { Shortcut } from "@/components/shortcut"
import { Button } from "@/components/ui/button"
import { SHORTCUTS } from "@/hooks/use-keyboard-nav"
import { useTheme, type ThemeMode } from "@/hooks/use-theme"
import { BUY_ME_A_COFFEE_URL, REPO_URL } from "@/lib/constants"
import { currentLang, strings, useStrings, type Lang } from "@/lib/i18n"
import { openExternal } from "@/lib/open"
import { isWeb } from "@/lib/platform"
import { feedbackUrl, osName } from "@/lib/report"
import { updateSettings, useSettings } from "@/lib/settings"
import { checkForUpdate, installUpdate, useUpdate } from "@/lib/updater"

const S = strings(
  {
    sections: {
      app: "Application",
      shortcuts: "Raccourcis clavier",
      about: "À propos",
    },
    app: { description: "Thème, langue et démarrage." },
    appearance: {
      theme: "Thème",
      shortcut: "Raccourci : d",
      light: "Clair",
      dark: "Sombre",
      auto: "Auto",
    },
    refresh: {
      launch: "Lancer à l'ouverture de session",
      launchDescription:
        "PR Radar démarre avec la session, pour ne manquer aucune notification.",
      launchError: (message: string) =>
        `Réglage du système impossible : ${message}`,
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
      feedback: "Envoyer un avis",
      feedbackDescription:
        "Une idée, une question, un bug ? Ouvre une discussion GitHub préremplie, à écrire et publier dans le navigateur.",
      feedbackButton: "Donner mon avis",
      links: "Liens",
      source: "Code source",
      download: "Page de téléchargement",
      report: "Signaler un problème",
      privacy: "Confidentialité",
      licenses: "Licences tierces",
    },
  },
  {
    sections: {
      app: "App",
      shortcuts: "Keyboard shortcuts",
      about: "About",
    },
    app: { description: "Theme, language and startup." },
    appearance: {
      theme: "Theme",
      shortcut: "Shortcut: d",
      light: "Light",
      dark: "Dark",
      auto: "Auto",
    },
    refresh: {
      launch: "Launch at login",
      launchDescription:
        "PR Radar starts with your session, so no notification is missed.",
      launchError: (message: string) =>
        `Could not change the system setting: ${message}`,
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
      feedback: "Send feedback",
      feedbackDescription:
        "An idea, a question, a bug? Opens a prefilled GitHub discussion, to write and post in your browser.",
      feedbackButton: "Give feedback",
      links: "Links",
      source: "Source code",
      download: "Download page",
      report: "Report an issue",
      privacy: "Privacy",
      licenses: "Third-party licenses",
    },
  },
)

const DOWNLOAD_URL = "https://vlor999.github.io/pr-radar/"

/** Catégorie « Général » : application, raccourcis clavier, à propos. */
export function GeneralCategory() {
  return (
    <>
      <AppSection />
      <ShortcutsSection />
      <AboutSection />
    </>
  )
}

/** Lignes de la catégorie pour la recherche des réglages, dans l'ordre d'affichage. */
export function generalEntries(lang: Lang): SettingsEntry[] {
  const t = S[lang]
  const shortcuts = SHORTCUTS[lang]
  return [
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
      desktopOnly: true,
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
      id: "feedback",
      category: "general",
      label: t.about.feedback,
      description: t.about.feedbackDescription,
      keywords: words(
        t.about.feedbackButton,
        "feedback avis suggestion idée idea bug discussion github retour",
      ),
    },
  ]
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
  const { lang } = useSettings()
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
      <Row
        id="feedback"
        label={t.about.feedback}
        description={t.about.feedbackDescription}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            openExternal(
              feedbackUrl(
                { version, os: osName(navigator.userAgent), web: isWeb },
                currentLang(lang),
              ),
            )
          }
        >
          <MessageSquare data-icon="inline-start" />
          {t.about.feedbackButton}
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
