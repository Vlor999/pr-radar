// Démo navigateur (`npm run demo`) : remplace les modules @tauri-apps/* par des faux.

const commands: Record<string, unknown> = {
  get_token: "demo",
  gh_token: "demo",
  uninstall_plan: {
    appPath: "/Applications/PR Radar.app",
    dataPaths: ["~/Library/Application Support/com.pr-radar.app"],
    note: "Démo : rien ne sera supprimé.",
  },
}

export async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  console.info("[demo] invoke", cmd, args ?? "")
  return (commands[cmd] ?? null) as T
}

export const getVersion = async () => "0.0.0-demo"
export const check = async () => null
export type Update = never
export const relaunch = async () => {}
export const openUrl = async (url: string) => {
  window.open(url, "_blank")
}
export const fetch = window.fetch.bind(window)
