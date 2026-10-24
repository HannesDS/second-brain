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

// Mode is light or dark, separate from the theme: every theme has both. `system` follows the OS.
// The resolved mode goes on <html data-mode>; index.html sets it early too.
export const MODES = ['light', 'dark', 'system'] as const
export type Mode = (typeof MODES)[number]
export const MODE_LABEL: Record<Mode, string> = { light: 'Light', dark: 'Dark', system: 'Match system' }

// Anything stored that isn't a mode (old, garbled, missing) falls back to light.
export const modeOf = (stored: unknown): Mode => ((MODES as readonly unknown[]).includes(stored) ? (stored as Mode) : 'light')

export const resolveMode = (choice: Mode, prefersDark: boolean): 'light' | 'dark' =>
  choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice

const darkQuery = () => matchMedia('(prefers-color-scheme: dark)')

export function useMode(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = useState<Mode>(() => modeOf(load<unknown>('sb.mode', 'light')))
  useEffect(() => {
    const q = darkQuery()
    const apply = () => { document.documentElement.dataset.mode = resolveMode(mode, q.matches) }
    apply()
    save('sb.mode', mode)
    if (mode !== 'system') return
    q.addEventListener('change', apply)
    return () => q.removeEventListener('change', apply)
  }, [mode])
  return [mode, setMode]
}

// The resolved mode, for libraries that take their colours in JS (xyflow, xterm). Follows <html data-mode>.
export function useDark(): boolean {
  const html = document.documentElement
  const [dark, setDark] = useState(html.dataset.mode === 'dark')
  useEffect(() => {
    const watch = new MutationObserver(() => setDark(html.dataset.mode === 'dark'))
    watch.observe(html, { attributes: true, attributeFilter: ['data-mode'] })
    return () => watch.disconnect()
  }, [html])
  return dark
}
