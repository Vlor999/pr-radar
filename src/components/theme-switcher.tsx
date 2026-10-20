import { Monitor, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme, type ThemeMode } from "@/hooks/use-theme"

const MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Clair", icon: Sun },
  { id: "dark", label: "Sombre", icon: Moon },
  { id: "system", label: "Auto", icon: Monitor },
]

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  return (
    <div role="group" aria-label="Thème" className="flex rounded-lg border p-0.5">
      {MODES.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          size="icon-sm"
          variant={theme === id ? "secondary" : "ghost"}
          aria-pressed={theme === id}
          aria-label={label}
          title={label}
          onClick={() => setTheme(id)}
        >
          <Icon />
        </Button>
      ))}
    </div>
  )
}
