import { ChevronDown } from "lucide-react"
import { useState } from "react"

import {
  words,
  type CategoryProps,
  type SettingsEntry,
} from "@/components/settings/category"
import { Row, Section, settingDomId, Toggle } from "@/components/settings/ui"
import { IS_MAC } from "@/components/shortcut"
import { Button } from "@/components/ui/button"
import {
  testNotification,
  useLastNotification,
} from "@/hooks/use-pr-notifications"
import { formatUntil, pause, resume, useQuiet } from "@/hooks/use-quiet"
import { locale, strings, useStrings, type Lang } from "@/lib/i18n"
import { openExternal } from "@/lib/open"
import { isWeb } from "@/lib/platform"
import { parseHm, systemZone } from "@/lib/quiet"
import { updateSettings, useSettings } from "@/lib/settings"

const S = strings(
  {
    sections: {
      when: "Quand notifier",
      pause: "Pause",
      troubleshoot: "Dépannage",
    },
    pause: {
      description: "Coupe les notifications un moment ou chaque jour.",
    },
    troubleshoot: {
      description:
        "Rien ne s'affiche ? Teste l'envoi et vérifie les réglages du système.",
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
  },
  {
    sections: {
      when: "When to notify",
      pause: "Pause",
      troubleshoot: "Troubleshooting",
    },
    pause: {
      description: "Silences notifications for a while or every day.",
    },
    troubleshoot: {
      description:
        "Nothing shows up? Send a test and check the system settings.",
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
  },
)

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

type TestState =
  { state: "sending" | "sent" } | { state: "error"; message: string } | null

/** Notifications : état en tête, quand notifier, pause, puis dépannage replié. */
export function NotificationsCategory(props: CategoryProps) {
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

/** Lignes de la catégorie pour la recherche des réglages, dans l'ordre d'affichage. */
export function notificationsEntries(lang: Lang): SettingsEntry[] {
  const t = S[lang]
  const n = t.notifications
  return [
    {
      id: "last",
      desktopOnly: true,
      category: "notifications",
      label: n.last,
      keywords: n.test,
    },
    ...NOTIFY.map((key): SettingsEntry => ({
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
      desktopOnly: true,
      category: "notifications",
      label: n.test,
      description: n.testHint,
      keywords: words(n.sendTest, t.sections.troubleshoot),
      group: t.sections.troubleshoot,
    },
    ...(SYSTEM_NOTIFICATION_SETTINGS
      ? [
          {
            id: "system",
            desktopOnly: true,
            category: "notifications",
            label: n.system,
            description: n.systemDescription,
            keywords: t.sections.troubleshoot,
            group: t.sections.troubleshoot,
          } satisfies SettingsEntry,
        ]
      : []),
    ...(IS_MAC
      ? [
          {
            id: "focus",
            desktopOnly: true,
            category: "notifications",
            label: n.focus,
            description: n.focusDescription,
            keywords: t.sections.troubleshoot,
            group: t.sections.troubleshoot,
          } satisfies SettingsEntry,
        ]
      : []),
  ]
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
