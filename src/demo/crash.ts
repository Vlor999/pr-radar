// Démo navigateur : plantage de la session précédente (src-tauri/src/crash.rs).
// `?crash` : panic Rust, `?crash=unclean` : fermeture inattendue ; sans paramètre, aucun plantage.
import type { LogEntry } from "@/lib/types"

const MIN = 60_000
const mode = new URLSearchParams(location.search).get("crash")
const startedAt = Date.now()
const previousStart = startedAt - 190 * MIN
const panicAt = startedAt - 3 * MIN

const PANIC = {
  ts: panicAt,
  message: "called `Option::unwrap()` on a `None` value",
  location: "src/web.rs:212:31",
}

/** entrées du journal de la session plantée (ajoutées au journal de démo) */
export const crashLogEntries: LogEntry[] =
  mode === null
    ? []
    : [
        {
          ts: panicAt - 20_000,
          level: "warn",
          event: "github.error",
          data: {
            account: "jdoe@ghe.acme.dev",
            status: 404,
            error:
              "Could not resolve https://ghe.acme.dev/api/v3/repos/acme/infra",
          },
        },
        ...(mode === "unclean"
          ? []
          : [
              {
                ts: panicAt,
                level: "error" as const,
                event: "app.panic",
                data: { ...PANIC, thread: "tokio-runtime-worker" },
              },
            ]),
      ]

export const crashCommands = {
  crash_status: () => ({
    previous:
      mode === null
        ? null
        : {
            startedAt: previousStart,
            panic: mode === "unclean" ? null : PANIC,
          },
    startedAt,
  }),
  session_clean: null,
}
