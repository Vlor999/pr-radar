import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"
import { routeLinksToBrowser } from "./lib/open"
import { setLowQuotaNotifier } from "./lib/quota"
import { notify } from "./hooks/use-pr-notifications"

routeLinksToBrowser()
setLowQuotaNotifier((title, body) => {
  notify(title, body).catch(() => {})
})

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
