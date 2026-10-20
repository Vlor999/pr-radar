import { useEffect } from "react"
import { Loader2 } from "lucide-react"

import { Login } from "@/components/login"
import { PrDashboard } from "@/components/pr-dashboard"
import { Button } from "@/components/ui/button"
import { useThemeEffects } from "@/hooks/use-theme"
import { loadToken, logout, useAuth } from "@/lib/auth"
import { clearCache } from "@/lib/github"
import { currentLang, strings, useStrings, type Lang } from "@/lib/i18n"
import { updateSettings, useSettings } from "@/lib/settings"
import { reload, useData } from "@/lib/store"

const S = strings(
  {
    rejected: "GitHub a refusé le jeton enregistré (révoqué ou expiré).",
    reconnect: "Se reconnecter",
    loading: "Chargement de tes PR…",
  },
  {
    rejected: "GitHub rejected the saved token (revoked or expired).",
    reconnect: "Sign in again",
    loading: "Loading your PRs…",
  },
)

export default function App() {
  useThemeEffects()
  const auth = useAuth()
  const { lang } = useSettings()

  useEffect(() => {
    loadToken()
  }, [])

  useEffect(() => {
    document.documentElement.lang = currentLang(lang)
  }, [lang])

  if (lang === null) return <LanguagePicker />
  if (auth.status === "loading") return <Splash />
  if (auth.status === "signed-out") return <Login />
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
    reload()
  }, [])

  if (data.authError)
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-muted-foreground">{t.rejected}</p>
        <Button onClick={() => logout()}>{t.reconnect}</Button>
      </main>
    )
  if (!data.fetchedAt && data.loading) return <Splash label={t.loading} />
  return (
    <PrDashboard
      prs={data.prs}
      trees={data.trees}
      withPrs={data.withPrs}
      fetchedAt={data.fetchedAt || new Date().toISOString()}
      error={data.error}
    />
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
