import { useEffect, useState } from 'react'
import { load, save } from './Home'

// Themes are token sets on <html data-theme>. Classic is the original look; Terrain is the new one.
// index.html sets the attribute before React loads, so there is no flash on reload.
export const THEMES = ['terrain', 'classic'] as const
export type Theme = (typeof THEMES)[number]
export const THEME_LABEL: Record<Theme, string> = { terrain: 'Terrain', classic: 'Classic' }

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = load<string>('sb.theme', 'terrain')
    return (THEMES as readonly string[]).includes(t) ? (t as Theme) : 'terrain'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    save('sb.theme', theme)
  }, [theme])
  const next = () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])
  return [theme, next]
}
