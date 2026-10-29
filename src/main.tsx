import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"
import { routeLinksToBrowser } from "./lib/open"
import { connectWeb, isWeb } from "./lib/platform"
import { setLowQuotaNotifier } from "./lib/quota"
import { pull, seed } from "./lib/sync"
import { notify } from "./hooks/use-pr-notifications"

async function boot() {
  if (isWeb) {
    // version web : session, puis réglages partagés de l'app dans localStorage avant le premier rendu
    await connectWeb().catch(() => {})
    await pull().catch(() => {})
    window.addEventListener("focus", () => void pull().catch(() => {}))
  } else {
    seed()
    setLowQuotaNotifier((title, body) => {
      notify(title, body).catch(() => {})
    })
  }
  routeLinksToBrowser()
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void boot()
