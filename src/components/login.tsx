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
import {
  CLIENT_ID,
  ghCliToken,
  pollDeviceFlow,
  saveToken,
  signInWithGh,
  startDeviceFlow,
  type DeviceCode,
} from "@/lib/auth"
import { viewerLogin } from "@/lib/github"
import { openExternal } from "@/lib/open"

const PAT_URL =
  "https://github.com/settings/tokens/new?scopes=repo,read:org&description=PR%20Radar"

/** Écran de connexion : code à valider sur github.com (device flow) ou jeton personnel. */
export function Login() {
  const [code, setCode] = useState<DeviceCode | null>(null)
  const [pat, setPat] = useState("")
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
      await saveToken(await pollDeviceFlow(c, abort.current.signal), "oauth")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCode(null)
    } finally {
      setBusy(false)
    }
  }

  const patLogin = async () => {
    setError("")
    setBusy(true)
    try {
      await viewerLogin(pat.trim()) // vérifie le jeton avant de l'enregistrer
      await saveToken(pat.trim(), "pat")
    } catch {
      setError(
        "Jeton refusé par GitHub : vérifie-le et ses droits (repo, read:org).",
      )
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

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md gap-6 px-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            PR Radar
          </h1>
          <p className="text-sm text-muted-foreground">
            Connecte ton compte GitHub. Le jeton reste dans le trousseau de ton
            ordinateur : l'app parle directement à GitHub, sans serveur
            intermédiaire.
          </p>
        </div>

        {CLIENT_ID && (
          <section className="flex flex-col gap-3">
            {code ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/60 px-4 py-5 text-center">
                <p className="text-sm text-muted-foreground">
                  {copied
                    ? "Code copié : colle-le sur github.com (⌘V)"
                    : "Saisis ce code sur github.com :"}
                </p>
                <button
                  type="button"
                  onClick={copy}
                  className="flex items-center gap-2 rounded-lg px-3 py-1 font-mono text-3xl font-semibold tracking-widest hover:bg-muted"
                  title="Copier"
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
                  Ouvrir {code.verification_uri.replace("https://", "")}{" "}
                  <ExternalLink />
                </Button>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> En attente de ta
                  validation…
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => abort.current?.abort()}
                >
                  Annuler
                </Button>
              </div>
            ) : (
              <Button size="lg" disabled={busy} onClick={deviceLogin}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                Se connecter avec GitHub
              </Button>
            )}
          </section>
        )}

        {hasGh && !code && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => signInWithGh()}
          >
            <Terminal />
            Utiliser mon compte du CLI gh
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
            Autres options : jeton d'accès personnel
          </button>
          {more && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (pat.trim()) patLogin()
              }}
            >
              <label htmlFor="pat" className="text-sm font-medium">
                Jeton d'accès personnel GitHub
              </label>
              <div className="flex gap-2">
                <Input
                  id="pat"
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="ghp_… ou github_pat_…"
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  variant={CLIENT_ID ? "outline" : "default"}
                  disabled={busy || !pat.trim()}
                >
                  <KeyRound />
                  Valider
                </Button>
              </div>
              <a
                href={PAT_URL}
                className="text-xs text-primary hover:underline"
              >
                Créer un jeton (droits repo et read:org) sur GitHub
              </a>
            </form>
          )}
        </section>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>
    </main>
  )
}
