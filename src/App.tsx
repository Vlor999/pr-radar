import { useEffect } from "react"
import { Loader2 } from "lucide-react"

import { Login } from "@/components/login"
import { PrDashboard } from "@/components/pr-dashboard"
import { Button } from "@/components/ui/button"
import { useThemeEffects } from "@/hooks/use-theme"
import { signOut } from "@/lib/actions"
import { loadToken, useAuth } from "@/lib/auth"
import { clearCache } from "@/lib/github"
import { startMcp } from "@/lib/mcp"
import { currentLang, strings, useStrings, type Lang } from "@/lib/i18n"
import { isWeb, useLocked } from "@/lib/platform"
import { updateSettings, useSettings } from "@/lib/settings"
import { reload, useData } from "@/lib/store"

const S = strings(
  {
    rejected: "GitHub a refusé le jeton enregistré (révoqué ou expiré).",
    reconnect: "Se reconnecter",
    loading: "Chargement de tes PR…",
    web: {
      locked:
        "Ce lien n'est plus valide. Rouvre la version web depuis l'app PR Radar (Réglages › Version web, ou l'icône de la barre des menus).",
      signedOut:
        "Aucun compte GitHub connecté. Connecte-toi dans l'app PR Radar, puis recharge cette page.",
      rejected:
        "Reconnecte ce compte dans l'app PR Radar, puis recharge cette page.",
    },
  },
  {
    rejected: "GitHub rejected the saved token (revoked or expired).",
    reconnect: "Sign in again",
    loading: "Loading your PRs…",
    web: {
      locked:
        "This link is no longer valid. Reopen the web version from the PR Radar app (Settings › Web version, or the menu bar icon).",
      signedOut:
        "No GitHub account connected. Sign in from the PR Radar app, then reload this page.",
      rejected:
        "Sign this account in again from the PR Radar app, then reload this page.",
    },
  },
)

export default function App() {
  useThemeEffects()
  const auth = useAuth()
  const { lang } = useSettings()
  const locked = useLocked()

  useEffect(() => {
    loadToken()
  }, [])

  // serveur MCP local : démarré quel que soit l'état de connexion (écran de connexion, jeton refusé)
  useEffect(() => void startMcp(), [])

  useEffect(() => {
    document.documentElement.lang = currentLang(lang)
  }, [lang])

  // version web : la connexion (GitHub, lien de l'app) se fait dans l'app
  if (isWeb && locked) return <WebMessage text="locked" />
  if (lang === null) return <LanguagePicker />
  if (auth.status === "loading") return <Splash />
  if (auth.status === "signed-out")
    return isWeb ? <WebMessage text="signedOut" /> : <Login />
  return <Dashboard />
}

/** Premier lancement : choix de la langue, modifiable ensuite dans les réglages. */
function LanguagePicker() {
  const choices: [Lang, string][] = [
    ["fr", "Français"],
    ["en", "English"],
  ]
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm text-muted-foreground">
        Choisis ta langue · Choose your language
      </p>
      <div className="flex gap-2">
        {choices.map(([value, label]) => (
          <Button
            key={value}
            variant={value === currentLang() ? "default" : "outline"}
            onClick={() => updateSettings({ lang: value })}
          >
            {label}
          </Button>
        ))}
      </div>
    </main>
  )
}

function Dashboard() {
  const data = useData()
  const t = useStrings(S)

  useEffect(() => {
    clearCache({ all: true }) // nouveau compte possible : rien ne doit venir du précédent
    reload({ measure: true })
  }, [])

  if (data.authError)
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-muted-foreground">{t.rejected}</p>
        {isWeb ? (
          <p className="text-sm text-muted-foreground">{t.web.rejected}</p>
        ) : (
          <Button
            onClick={() =>
              // compte inconnu : on relit sans déconnecter personne
              data.authAccount ? signOut(data.authAccount) : reload()
            }
          >
            {t.reconnect}
          </Button>
        )}
      </main>
    )
  if (!data.fetchedAt && data.loading) return <Splash label={t.loading} />
  return (
    <PrDashboard
      prs={data.prs}
      trees={data.trees}
      withPrs={data.withPrs}
      reviews={data.reviews}
      fetchedAt={data.fetchedAt || new Date().toISOString()}
      error={data.error}
    />
  )
}

function WebMessage({ text }: { text: "locked" | "signedOut" }) {
  const t = useStrings(S)
  return (
    <main className="flex min-h-svh items-center justify-center px-4 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{t.web[text]}</p>
    </main>
  )
}

function Splash({ label }: { label?: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </main>
  )
}
