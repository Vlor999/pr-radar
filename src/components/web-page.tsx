import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import {
  Feedback,
  Row,
  Section,
  Toggle,
  useConfirm,
  useFlash,
} from "@/components/settings-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { strings, useStrings } from "@/lib/i18n"
import { invoke } from "@/lib/platform"
import type { WebStatus } from "@/lib/types"
import {
  configureWeb,
  loadWebStatus,
  startErrorText,
  useWebStatus,
  WEB_ERRORS,
} from "@/lib/web"

const MIN_PORT = 1024 // en dessous : ports réservés au système
const MAX_PORT = 65_535

const S = strings(
  {
    back: "Retour",
    title: "Version web",
    subtitle:
      "Ouvre PR Radar dans un onglet du navigateur, servi par l'app sur cette machine uniquement (127.0.0.1). La fenêtre peut ensuite être fermée : l'app reste dans la barre des menus et envoie les notifications.",
    server: "Serveur",
    serverDescription: "Désactivé par défaut.",
    enable: "Activer la version web",
    running: (url: string) => `Active sur ${url}`,
    stopped: "Désactivée",
    port: "Port",
    portDescription: "Port local du serveur (1024 à 65535).",
    apply: "Appliquer",
    invalidPort: "Port invalide : un nombre entre 1024 et 65535.",
    open: "Ouvrir dans le navigateur",
    openDescription:
      "Chaque lien sert une seule fois pendant une minute, échangé à l'ouverture contre une session du navigateur.",
    secret: "Sessions des navigateurs",
    secretDescription:
      "Ferme toutes les sessions ouvertes : rouvre ensuite la version web depuis l'app.",
    rotate: "Déconnecter les navigateurs",
    confirmRotate: "Confirmer",
  },
  {
    back: "Back",
    title: "Web version",
    subtitle:
      "Opens PR Radar in a browser tab, served by the app on this machine only (127.0.0.1). The window can then be closed: the app stays in the menu bar and sends the notifications.",
    server: "Server",
    serverDescription: "Off by default.",
    enable: "Enable the web version",
    running: (url: string) => `Running at ${url}`,
    stopped: "Off",
    port: "Port",
    portDescription: "Local port of the server (1024 to 65535).",
    apply: "Apply",
    invalidPort: "Invalid port: a number between 1024 and 65535.",
    open: "Open in browser",
    openDescription:
      "Each link works once for one minute, exchanged for a browser session when opened.",
    secret: "Browser sessions",
    secretDescription:
      "Closes every open session: then reopen the web version from the app.",
    rotate: "Sign out browsers",
    confirmRotate: "Confirm",
  },
)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Version web locale : serveur de l'app sur 127.0.0.1, ouvert dans le navigateur (src-tauri/src/web.rs). */
function ServerSection() {
  const t = useStrings(S)
  const errors = useStrings(WEB_ERRORS)
  const status = useWebStatus()
  const [port, setPort] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [secretMsg, flashSecret] = useFlash()
  const [armed, confirm] = useConfirm()

  const show = (s: WebStatus) => setPort(String(s.port))
  useEffect(() => {
    loadWebStatus().then(show, (e: unknown) => setError(message(e)))
  }, [])

  const configure = async (enabled: boolean, p: number) => {
    if (!Number.isInteger(p) || p < MIN_PORT || p > MAX_PORT) {
      setError(t.invalidPort)
      return
    }
    setBusy(true)
    setError("")
    try {
      show(await configureWeb(enabled, p))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status)
    return (
      <Section
        id="web-server"
        title={t.server}
        description={t.serverDescription}
      >
        <p className="py-3 text-sm text-destructive">{error}</p>
      </Section>
    )
  const url = `http://127.0.0.1:${status.port}`
  const startError = startErrorText(errors, status)
  return (
    <Section id="web-server" title={t.server} description={t.serverDescription}>
      <Row
        label={t.enable}
        labelId="web-enable-label"
        description={status.running ? t.running(url) : t.stopped}
      >
        <Toggle
          checked={status.enabled}
          onChange={(v) => void configure(v, status.port)}
          labelledBy="web-enable-label"
        />
      </Row>
      <Row
        label={t.port}
        labelId="web-port-label"
        description={t.portDescription}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={MIN_PORT}
          max={MAX_PORT}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          aria-labelledby="web-port-label"
          className="w-24 tabular-nums"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy || port === String(status.port)}
          onClick={() => void configure(status.enabled, Number(port))}
        >
          {busy && (
            <Loader2
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          )}
          {t.apply}
        </Button>
      </Row>
      {(error || startError) && (
        <p role="alert" className="pb-3 text-xs text-destructive">
          {error || startError}
        </p>
      )}
      {status.running && (
        <Row label={t.open} description={t.openDescription}>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void invoke("web_open").catch((e: unknown) =>
                setError(message(e)),
              )
            }
          >
            {t.open}
            <ExternalLink data-icon="inline-end" />
          </Button>
        </Row>
      )}
      <Row label={t.secret} description={t.secretDescription}>
        <Feedback msg={secretMsg} />
        <Button
          variant={armed ? "destructive" : "outline"}
          size="sm"
          onClick={() =>
            confirm(() =>
              invoke("web_revoke").then(
                () => flashSecret(),
                (e: unknown) => setError(message(e)),
              ),
            )
          }
        >
          {armed ? t.confirmRotate : t.rotate}
        </Button>
      </Row>
    </Section>
  )
}

export function WebPage({ onClose }: { onClose: () => void }) {
  const t = useStrings(S)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Échap dans le champ du port : reste sur la page
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement))
        onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-4 pb-16 md:px-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onClose} className="-ml-2">
          <ArrowLeft data-icon="inline-start" />
          {t.back}
        </Button>
        <h1 className="mt-2 font-heading text-xl font-semibold tracking-tight">
          {t.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
      </div>
      <ServerSection />
    </div>
  )
}
