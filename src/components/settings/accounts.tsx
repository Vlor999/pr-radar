import { cn } from "cn"
import {
  Building2,
  Check,
  ExternalLink,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
} from "lucide-react"
import { useEffect, useState } from "react"

import { AuthSourceIcon } from "@/components/auth-source-icon"
import { Login } from "@/components/login"
import { words, type SettingsEntry } from "@/components/settings/category"
import { SlackGithubTable } from "@/components/settings/slack-github"
import { Row, Section, settingDomId, Toggle } from "@/components/settings/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GITHUB, type Account } from "@/lib/accounts"
import { accountAdded, signOut } from "@/lib/actions"
import { CLIENT_ID, useAuth } from "@/lib/auth"
import { viewerProfile, type Profile } from "@/lib/github"
import { locale, strings, useStrings, type Lang } from "@/lib/i18n"
import { openExternal } from "@/lib/open"
import { isWeb } from "@/lib/platform"
import { updateSettings, useSettings } from "@/lib/settings"
import {
  cachedConversations,
  connectSlack,
  disconnectSlack,
  forceRefreshMentions,
  listConversations,
  useSlack,
  useSlackProgress,
} from "@/lib/slack"
import type { SlackConversation } from "@/lib/types"

const S = strings(
  {
    sections: {
      accounts: "Comptes GitHub",
      slack: "Slack",
    },
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
      enterprise: "Hôte GitHub Enterprise",
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
  },
  {
    sections: {
      accounts: "GitHub accounts",
      slack: "Slack",
    },
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
      enterprise: "GitHub Enterprise host",
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
  },
)

/** durée de la coche après une relecture forcée des mentions */
const CHECK_MS = 1_500

/** Catégorie « Comptes » : comptes GitHub, Slack. */
export function AccountsCategory() {
  return (
    <>
      <AccountSection />
      <SlackSection />
    </>
  )
}

/** Lignes de la catégorie pour la recherche des réglages, dans l'ordre d'affichage. */
export function accountsEntries(lang: Lang): SettingsEntry[] {
  const t = S[lang]
  return [
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
  ]
}

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
        {host !== GITHUB && (
          <span
            title={t.account.enterprise}
            className="ml-auto inline-flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            <Building2 aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{host}</span>
          </span>
        )}
      </div>
      <Row
        label={t.account.via}
        description={source === "gh" ? t.account.ghNote : undefined}
      >
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <AuthSourceIcon source={source} />
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
  // dernière liste lue (cache local) affichée tout de suite, relue en arrière-plan
  const [convs, setConvs] = useState<SlackConversation[] | null>(() =>
    team ? cachedConversations() : null,
  )
  const [fresh, setFresh] = useState(false)
  const [query, setQuery] = useState("")
  const live = !!team && !expired
  useEffect(() => {
    // lue même avec « toutes les conversations » : la table Slack → GitHub liste les DM 1:1
    if (!live || fresh) return
    let alive = true
    setError("")
    // DM sans nom connu d'abord affichés avec l'id du destinataire, puis avec son nom
    listConversations((l) => alive && setConvs(l)).then(
      (l) => {
        if (!alive) return
        setConvs(l)
        setFresh(true)
      },
      (e: unknown) => alive && setError(message(e)),
    )
    return () => {
      alive = false
    }
  }, [live, fresh])

  const connect = async () => {
    setBusy(true)
    setError("")
    try {
      await connectSlack()
      setConvs(cachedConversations())
      setFresh(false)
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
              onClick={() =>
                void disconnectSlack().then(() => {
                  setConvs(null)
                  setFresh(false)
                })
              }
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
        {/* tout de suite, lignes fantômes tant que la liste n'est pas lue (sauf échec sans cache) */}
        {live && team && (convs || !error) && (
          <SlackGithubTable convs={convs} team={team.id} />
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
