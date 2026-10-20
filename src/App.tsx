import { useEffect } from "react"
import { Loader2 } from "lucide-react"

import { Login } from "@/components/login"
import { PrDashboard } from "@/components/pr-dashboard"
import { Button } from "@/components/ui/button"
import { useThemeEffects } from "@/hooks/use-theme"
import { loadToken, logout, useAuth } from "@/lib/auth"
import { clearCache } from "@/lib/github"
import { reload, useData } from "@/lib/store"

export default function App() {
  useThemeEffects()
  const auth = useAuth()

  useEffect(() => {
    loadToken()
  }, [])

  if (auth.status === "loading") return <Splash />
  if (auth.status === "signed-out") return <Login />
  return <Dashboard />
}

function Dashboard() {
  const data = useData()

  useEffect(() => {
    clearCache({ all: true }) // nouveau compte possible : rien ne doit venir du précédent
    reload()
  }, [])

  if (data.authError)
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-muted-foreground">
          GitHub a refusé le jeton enregistré (révoqué ou expiré).
        </p>
        <Button onClick={() => logout()}>Se reconnecter</Button>
      </main>
    )
  if (!data.fetchedAt && data.loading)
    return <Splash label="Chargement de tes PR…" />
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
