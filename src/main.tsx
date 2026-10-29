import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"
import { WebWaiting } from "./components/web-waiting"
import { routeLinksToBrowser } from "./lib/open"
import { connectWeb, HttpError, isWeb } from "./lib/platform"
import { setLowQuotaNotifier } from "./lib/quota"
import { pull, seed } from "./lib/sync"
import { notify } from "./hooks/use-pr-notifications"

/** version web : nouvel essai tant que l'app n'a pas envoyé ses réglages */
const RETRY_MS = 2_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Version web : réglages partagés de l'app dans localStorage avant le premier rendu de l'interface. */
async function hydrate(root: ReactDOM.Root) {
  for (let waiting = false; ; waiting = true) {
    try {
      await pull()
      return
    } catch (e) {
      // session refusée : l'interface affiche comment rouvrir le lien
      if (e instanceof HttpError && e.status === 401) return
      if (!waiting) root.render(<WebWaiting />)
      await sleep(RETRY_MS)
    }
  }
}

async function boot() {
  const root = ReactDOM.createRoot(
    document.getElementById("root") as HTMLElement,
  )
  if (isWeb) {
    await connectWeb().catch(() => {})
    await hydrate(root)
  } else {
    await seed().catch(() => {})
    setLowQuotaNotifier((title, body) => {
      notify(title, body).catch(() => {})
    })
  }
  // retour sur la fenêtre ou l'onglet : changements faits dans l'autre relus (sans relire GitHub)
  window.addEventListener("focus", () => void pull().catch(() => {}))
  routeLinksToBrowser()
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void boot()
