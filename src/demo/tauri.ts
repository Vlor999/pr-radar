// Démo navigateur (`npm run demo`) : remplace les modules @tauri-apps/* par des faux.

/** Version web (réglages) : port 1420 refusé comme déjà utilisé, celui de la démo. */
const web = {
  enabled: false,
  port: 14200,
  running: false,
  error: null as string | null,
}
const DEMO_PORT = 1420

const commands: Record<
  string,
  unknown | ((args: Record<string, unknown>) => unknown)
> = {
  web_status: () => ({ ...web }),
  web_configure: ({ enabled, port }: Record<string, unknown>) => {
    web.enabled = enabled === true
    web.port = Number(port)
    web.error = web.enabled && web.port === DEMO_PORT ? "port-busy" : null
    web.running = web.enabled && !web.error
    return { ...web }
  },
  // aperçu de la version web : la démo elle-même, sections réservées à l'app masquées
  web_open: () => void window.open("/?web", "_blank"),
  get_token: "demo",
  gh_token: "demo",
  uninstall_plan: {
    appPath: "/Applications/PR Radar.app",
    dataPaths: ["~/Library/Application Support/com.pr-radar.app"],
    note: null, // démo : invoke journalisé, rien n'est supprimé
  },
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  console.info("[demo] invoke", cmd, args ?? "")
  const c = commands[cmd]
  return (typeof c === "function" ? c(args ?? {}) : (c ?? null)) as T
}

export const getVersion = async () => "0.0.0-demo"
export const check = async () => null
export type Update = never
export const relaunch = async () => {}
export const openUrl = async (url: string) => {
  window.open(url, "_blank")
}
export const fetch = window.fetch.bind(window)

// lancement à l'ouverture de session : état du « système » gardé en mémoire
let autostart = false
export const isEnabled = async () => autostart
export const enable = async () => {
  autostart = true
}
export const disable = async () => {
  autostart = false
}
