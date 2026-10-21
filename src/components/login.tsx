import { useEffect, useRef, useState } from "react"
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Terminal,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { GITHUB, normalizeHost } from "@/lib/accounts"
import {
  addAccount,
  allowHost,
  CLIENT_ID,
  ghCliToken,
  pollDeviceFlow,
  startDeviceFlow,
  type DeviceCode,
} from "@/lib/auth"
import { viewerLogin } from "@/lib/github"
import { useStrings, strings } from "@/lib/i18n"
import { openExternal } from "@/lib/open"

const S = strings(
  {
    patRejected:
      "Jeton refusé par GitHub : vérifie-le et ses droits (repo, read:org).",
    intro:
      "Connecte ton compte GitHub. Le jeton reste dans le trousseau de ton ordinateur : l'app parle directement à GitHub, sans serveur intermédiaire.",
    codeCopied: "Code copié : colle-le sur github.com (⌘V)",
    enterCode: "Saisis ce code sur github.com :",
    copy: "Copier",
    open: (host: string) => `Ouvrir ${host}`,
    waiting: "En attente de ta validation…",
    cancel: "Annuler",
    signIn: "Se connecter avec GitHub",
    useGh: "Utiliser mon compte du CLI gh",
    moreOptions: "Autres options : jeton d'accès personnel, GitHub Enterprise",
    hostLabel: "Hôte GitHub Enterprise (vide pour github.com)",
    invalidHost: "Hôte invalide (exemple : ghe.example.com)",
    patLabel: "Jeton d'accès personnel GitHub",
    patPlaceholder: "ghp_… ou github_pat_…",
    submit: "Valider",
    createPat: "Créer un jeton (droits repo et read:org) sur GitHub",
  },
  {
    patRejected:
      "GitHub rejected the token: check it and its scopes (repo, read:org).",
    intro:
      "Sign in with your GitHub account. The token stays in your computer's keychain: the app talks directly to GitHub, with no intermediary server.",
    codeCopied: "Code copied: paste it on github.com (⌘V)",
    enterCode: "Enter this code on github.com:",
    copy: "Copy",
    open: (host: string) => `Open ${host}`,
    waiting: "Waiting for you to authorize…",
    cancel: "Cancel",
    signIn: "Sign in with GitHub",
    useGh: "Use my gh CLI account",
    moreOptions: "More options: personal access token, GitHub Enterprise",
    hostLabel: "GitHub Enterprise host (empty for github.com)",
    invalidHost: "Invalid host (example: ghe.example.com)",
    patLabel: "GitHub personal access token",
    patPlaceholder: "ghp_… or github_pat_…",
    submit: "Submit",
    createPat: "Create a token (repo and read:org scopes) on GitHub",
  },
)

const patUrl = (host: string) =>
  `https://${host}/settings/tokens/new?scopes=repo,read:org&description=PR%20Radar`

/**
 * Écran de connexion : code à valider sur github.com (device flow), CLI gh, ou jeton personnel
 * (github.com ou GitHub Enterprise). Avec `onDone`, formulaire d'ajout de compte des réglages.
 */
export function Login({ onDone }: { onDone?: (id?: string) => void } = {}) {
  const t = useStrings(S)
  const [code, setCode] = useState<DeviceCode | null>(null)
  const [pat, setPat] = useState("")
  const [host, setHost] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hasGh, setHasGh] = useState(false)
  const [more, setMore] = useState(false)
  const abort = useRef<AbortController | null>(null)

  // CLI `gh` connecté sur la machine (ex. après une déconnexion) : proposé en un clic
  useEffect(() => {
    ghCliToken().then((t) => setHasGh(!!t))
  }, [])

  const deviceLogin = async () => {
    setError("")
    setBusy(true)
    try {
      const c = await startDeviceFlow()
      setCode(c)
      // code dans le presse-papier : sur github.com, un ⌘V suffit
      navigator.clipboard.writeText(c.user_code).then(
        () => setCopied(true),
        () => {},
      )
      openExternal(c.verification_uri)
      abort.current = new AbortController()
      const token = await pollDeviceFlow(c, abort.current.signal)
      onDone?.(
        await addAccount(token, "oauth", GITHUB, await viewerLogin(token)),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCode(null)
    } finally {
      setBusy(false)
    }
  }

  const ghLogin = async () => {
    const token = await ghCliToken()
    if (token)
      onDone?.(await addAccount(token, "gh", GITHUB, await viewerLogin(token)))
  }

  const patLogin = async () => {
    const h = host.trim() ? normalizeHost(host) : GITHUB
    if (!h) return setError(t.invalidHost)
    setError("")
    setBusy(true)
    try {
      await allowHost(h)
      const login = await viewerLogin(pat.trim(), h) // vérifie le jeton avant de l'enregistrer
      onDone?.(await addAccount(pat.trim(), "pat", h, login))
    } catch {
      setError(t.patRejected)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code.user_code)
      setCopied(true)
    } catch {}
  }

  const body = (
    <>
      {CLIENT_ID && (
        <section className="flex flex-col gap-3">
          {code ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/60 px-4 py-5 text-center">
              <p className="text-sm text-muted-foreground">
                {copied ? t.codeCopied : t.enterCode}
              </p>
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-2 rounded-lg px-3 py-1 font-mono text-3xl font-semibold tracking-widest hover:bg-muted"
                title={t.copy}
              >
                {code.user_code}
                {copied ? (
                  <Check className="size-5 text-primary" />
                ) : (
                  <Copy className="size-5 text-muted-foreground" />
                )}
              </button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openExternal(code.verification_uri)}
              >
                {t.open(code.verification_uri.replace("https://", ""))}{" "}
                <ExternalLink />
              </Button>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> {t.waiting}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => abort.current?.abort()}
              >
                {t.cancel}
              </Button>
            </div>
          ) : (
            <Button size="lg" disabled={busy} onClick={deviceLogin}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {t.signIn}
            </Button>
          )}
        </section>
      )}

      {hasGh && !code && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void ghLogin().catch((e: unknown) =>
              setError(e instanceof Error ? e.message : String(e)),
            )
          }
        >
          <Terminal />
          {t.useGh}
        </Button>
      )}

      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className="group flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="size-3.5 transition-transform group-aria-expanded:rotate-90" />
          {t.moreOptions}
        </button>
        {more && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (pat.trim()) patLogin()
            }}
          >
            <label htmlFor="host" className="text-sm font-medium">
              {t.hostLabel}
            </label>
            <Input
              id="host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="ghe.example.com"
              autoComplete="off"
              spellCheck={false}
            />
            <label htmlFor="pat" className="text-sm font-medium">
              {t.patLabel}
            </label>
            <div className="flex gap-2">
              <Input
                id="pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={t.patPlaceholder}
                autoComplete="off"
              />
              <Button
                type="submit"
                variant={CLIENT_ID ? "outline" : "default"}
                disabled={busy || !pat.trim()}
              >
                <KeyRound />
                {t.submit}
              </Button>
            </div>
            <a
              href={patUrl(normalizeHost(host) ?? GITHUB)}
              className="text-xs text-primary hover:underline"
            >
              {t.createPat}
            </a>
          </form>
        )}
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  )

  if (onDone)
    return (
      <div className="flex flex-col gap-4">
        {body}
        {!code && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => onDone()}
          >
            {t.cancel}
          </Button>
        )}
      </div>
    )
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md gap-6 px-8">
        <div className="flex flex-col gap-1">
          <img src="/logo.svg" alt="" className="mb-2 size-14" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            PR Radar
          </h1>
          <p className="text-sm text-muted-foreground">{t.intro}</p>
        </div>
        {body}
      </Card>
    </main>
  )
}
