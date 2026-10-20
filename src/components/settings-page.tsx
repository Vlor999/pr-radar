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
import { openExternal } from "@/lib/open"
import { LOW, resetTime, useQuota } from "@/lib/quota"
import { resetSettings, updateSettings, useSettings } from "@/lib/settings"
import { checkForUpdate, installUpdate, useUpdate } from "@/lib/updater"
import { getRepos, reload, setRepos } from "@/lib/store"

const SECTIONS = [
  ["compte", "Compte"],
  ["apparence", "Apparence"],
  ["actualisation", "Actualisation"],
  ["notifications", "Notifications"],
  ["affichage", "Affichage des PR"],
  ["repos", "Repos suivis"],
  ["donnees", "Données"],
  ["raccourcis", "Raccourcis clavier"],
  ["a-propos", "À propos"],
] as const

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
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    msg,
    (m = "Fait") => {
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
      title="Compte"
      description="Le compte GitHub utilisé pour lire vos PR."
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
          <p className="text-sm text-destructive">
            Impossible de charger le profil GitHub.
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
        label="Connecté via"
        description={
          source === "gh"
            ? "Se déconnecter arrête de réutiliser le compte du CLI gh jusqu'à la prochaine connexion."
            : undefined
        }
      >
        <span className="text-sm text-muted-foreground">
          {source === "oauth"
            ? "GitHub (connexion OAuth)"
            : source === "pat"
              ? "Jeton personnel"
              : source === "gh"
                ? "CLI gh"
                : "Inconnu"}
        </span>
      </Row>
      <Row label="Session">
        {manageUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openExternal(manageUrl)}
          >
            Gérer l'accès sur GitHub
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
          Se déconnecter
        </Button>
      </Row>
    </Section>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  return (
    <Section
      id="apparence"
      title="Apparence"
      description="Le thème de l'interface."
    >
      <Row label="Thème" labelId="theme-label" description="Raccourci : d">
        <Segmented<ThemeMode>
          labelledBy="theme-label"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: "Clair", icon: <Sun /> },
            { value: "dark", label: "Sombre", icon: <Moon /> },
            { value: "system", label: "Auto", icon: <Monitor /> },
          ]}
        />
      </Row>
    </Section>
  )
}

function RefreshSection() {
  const s = useSettings()
  const quota = useQuota()
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setBusy(true)
    clearCache()
    await reload().finally(() => setBusy(false))
  }
  return (
    <Section
      id="actualisation"
      title="Actualisation"
      description="Quand PR Radar relit GitHub."
    >
      <Row label="Fréquence" labelId="refresh-label">
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
              {m === 0 ? "Manuelle" : `${m} min`}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Actualiser en revenant sur la fenêtre" labelId="focus-label">
        <Toggle
          labelledBy="focus-label"
          checked={s.refreshOnFocus}
          onChange={(v) => updateSettings({ refreshOnFocus: v })}
        />
      </Row>
      <Row
        label="Quota GitHub"
        description="Points GraphQL par heure. Notification sous 10 % restants."
      >
        {quota ? (
          <div className="flex w-full flex-col gap-1.5 sm:w-64">
            <div
              role="meter"
              aria-label="Quota GitHub restant"
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
              {`${quota.remaining.toLocaleString("fr-FR")} / ${quota.limit.toLocaleString("fr-FR")} restants · réinitialisé à ${resetTime(quota.resetAt)}`}
            </span>
          </div>
        ) : (
          <span className="text-sm">
            Inconnu avant la première actualisation
          </span>
        )}
      </Row>
      <Row label="Relire tout maintenant">
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
          Actualiser maintenant
        </Button>
      </Row>
    </Section>
  )
}

const NOTIFY = [
  ["approved", "Approbation"],
  ["changesRequested", "Changements demandés"],
  ["comments", "Nouveaux commentaires"],
  ["ciFailed", "CI en échec"],
] as const

// sur ordinateur, c'est le système qui autorise ou bloque : on renvoie vers ses réglages
const SYSTEM_NOTIFICATION_SETTINGS = navigator.userAgent.includes("Mac")
  ? "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
  : navigator.userAgent.includes("Windows")
    ? "ms-settings:notifications"
    : null

function NotificationsSection() {
  const s = useSettings()
  const last = useLastNotification()
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
      title="Notifications"
      description="Notifications système envoyées quand une PR change, tant que l'app est ouverte."
    >
      <Row
        label="Tester"
        description={
          test?.state === "sent"
            ? "Envoyée. Rien n'est apparu ? Le système bloque PR Radar : voir ci-dessous."
            : test?.state === "error"
              ? `Échec : ${test.message}`
              : "Envoie une notification maintenant pour vérifier."
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={test?.state === "sending"}
          onClick={send}
        >
          Envoyer une notification de test
        </Button>
      </Row>
      <Row
        label="Dernière notification"
        description={
          last
            ? `${last.title} · ${new Date(last.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`
            : "Aucune pour l'instant."
        }
      />
      {SYSTEM_NOTIFICATION_SETTINGS && (
        <Row
          label="Autorisation du système"
          description="C'est le système qui affiche ou bloque les notifications. Vérifie que PR Radar y est autorisée (bannières ou alertes)."
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => openExternal(SYSTEM_NOTIFICATION_SETTINGS)}
          >
            Ouvrir les réglages du système
          </Button>
        </Row>
      )}
      {NOTIFY.map(([key, label]) => (
        <Row key={key} label={label} labelId={`notify-${key}`}>
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
  const days = (n: number[]) => n.map((d) => ({ value: d, label: `${d} j` }))
  return (
    <Section
      id="affichage"
      title="Affichage des PR"
      description="Tri et repères de la vue des PR."
    >
      <Row label="Tri par défaut" labelId="sort-label">
        <Segmented
          labelledBy="sort-label"
          value={s.defaultSort}
          onChange={(v) => updateSettings({ defaultSort: v })}
          options={[
            { value: "priority", label: "Priorité" },
            { value: "oldest", label: "Plus anciennes" },
            { value: "recent", label: "Plus récentes" },
          ]}
        />
      </Row>
      <Row
        label="Inactive après"
        labelId="stale-label"
        description="Jours sans activité avant le badge « inactive »."
      >
        <Segmented
          labelledBy="stale-label"
          value={s.staleDays}
          onChange={(v) => updateSettings({ staleDays: v })}
          options={days([3, 5, 7, 14, 30])}
        />
      </Row>
      <Row
        label="Mergées récemment"
        labelId="merged-label"
        description="Période affichée sous chaque repo."
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
  const follow = async () => {
    setBusy(true)
    try {
      const repos = await reposWithMyOpenPrs()
      setRepos(repos)
      setCount(repos.length)
      flash()
      void reload()
    } catch {
      flash("Échec")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      id="repos"
      title="Repos suivis"
      description="La liste se gère dans le panneau de gauche de la vue des PR."
    >
      <Row label="Repos suivis" description={`${count} repo(s)`}>
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
          {armed
            ? "Confirmer — remplace la liste actuelle"
            : "Suivre les repos où j'ai des PR ouvertes"}
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
  return (
    <Section
      id="donnees"
      title="Données"
      description="Tout est gardé sur cette machine."
    >
      <Row label="Cache" description="Relit tout depuis GitHub.">
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
          Vider le cache
        </Button>
      </Row>
      <Row
        label="Marques « vu »"
        description="Toutes les PR redeviennent nouvelles."
      >
        <Feedback msg={seenMsg} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            resetSeen()
            flashSeen()
          }}
        >
          Oublier les marques « vu »
        </Button>
      </Row>
      <Row label="Réglages" description="Revient aux valeurs par défaut.">
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
          {armed
            ? "Confirmer la réinitialisation"
            : "Réinitialiser les réglages"}
        </Button>
      </Row>
      <UninstallRow />
    </Section>
  )
}

type UninstallPlan = {
  appPath: string | null
  dataPaths: string[]
  note: string | null
}

/** Désinstallation complète : liste ce qui sera supprimé, confirmation tapée, puis l'app se ferme. */
function UninstallRow() {
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
      <Row
        label="Désinstaller PR Radar"
        description="Supprime l'app et tout ce qu'elle a créé sur cette machine : jeton GitHub, réglages, cache. Ton compte GitHub n'est pas touché."
      >
        {!open && (
          <Button variant="destructive" size="sm" onClick={show}>
            <Trash2 />
            Désinstaller…
          </Button>
        )}
      </Row>
      {open && (
        <div className="mb-1 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          {!plan && state !== "error" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              Inventaire de ce qui sera supprimé…
            </p>
          )}
          {plan && (
            <>
              <div>
                <p className="font-medium">Sera supprimé :</p>
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs break-all text-muted-foreground">
                  <li>Jeton GitHub du trousseau du système</li>
                  {plan.appPath && <li>{plan.appPath}</li>}
                  {plan.dataPaths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              {plan.note && (
                <p className="text-amber-700 dark:text-amber-400">
                  {plan.note}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Pour révoquer aussi l'accès côté GitHub : Settings →
                Applications → PR Radar.
              </p>
              <label
                htmlFor="uninstall-confirm"
                className="text-xs font-medium"
              >
                Tape SUPPRIMER pour confirmer
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
                  disabled={typed.trim() !== "SUPPRIMER" || state === "running"}
                  onClick={() => void run()}
                >
                  {state === "running" ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Trash2 />
                  )}
                  Tout supprimer et quitter
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
                  Annuler
                </Button>
              </div>
            </>
          )}
          {state === "error" && (
            <p className="text-destructive">
              Désinstallation impossible : {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ShortcutsSection() {
  const rows = [
    ...SHORTCUTS,
    { keys: "⌘ ,", label: "ouvrir les réglages" },
    { keys: "Échap", label: "fermer les réglages" },
  ]
  return (
    <Section
      id="raccourcis"
      title="Raccourcis clavier"
      description="Actifs hors des champs de saisie."
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
      title="À propos"
      description="Gratuit, open source (MIT). Aucun serveur : l'app parle directement à GitHub."
    >
      <Row
        label="PR Radar"
        description={version ? `Version ${version}` : "Version …"}
      >
        <span aria-live="polite" className="text-xs">
          {update.status === "up-to-date" && (
            <span className="text-muted-foreground">À jour</span>
          )}
          {update.status === "error" && (
            <span className="text-destructive" title={update.message}>
              Mise à jour impossible
            </span>
          )}
          {update.status === "available" && (
            <span className="font-medium text-primary">
              Version {update.version} disponible
            </span>
          )}
          {update.status === "downloading" && (
            <span className="text-muted-foreground">
              Téléchargement
              {update.progress !== null
                ? ` · ${Math.round(update.progress * 100)} %`
                : "…"}
            </span>
          )}
          {update.status === "ready" && (
            <span className="text-muted-foreground">Redémarrage…</span>
          )}
        </span>
        {update.status === "available" ? (
          <Button size="sm" onClick={() => void installUpdate()}>
            Installer et redémarrer
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
            Rechercher une mise à jour
          </Button>
        )}
      </Row>
      <Row label="Liens">
        {[
          ["Code source", REPO_URL],
          ["Page de téléchargement", DOWNLOAD_URL],
          ["Signaler un problème", `${REPO_URL}/issues/new`],
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
  const [active, setActive] = useState<string>(SECTIONS[0][0])

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
    SECTIONS.forEach(([id]) => {
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
        aria-label="Sections des réglages"
        className="shrink-0 md:sticky md:top-4 md:w-48 md:self-start"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="mb-2 -ml-2"
        >
          <ArrowLeft data-icon="inline-start" />
          Retour
        </Button>
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
          {SECTIONS.map(([id, label]) => (
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
                {label}
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
