import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { MODES, MODE_LABEL, type Mode } from './theme'

// One button style for every small action: a Lucide icon, the label as tooltip and for screen readers,
// optionally shown as text. `stop` keeps the click from reaching a clickable card underneath.
export function IconButton({ icon: Icon, label, onClick, showLabel, primary, active, stop, disabled }: {
  icon: LucideIcon; label: string; onClick: () => void; showLabel?: boolean; primary?: boolean; active?: boolean; stop?: boolean; disabled?: boolean
}) {
  const click = (e: MouseEvent) => { if (stop) e.stopPropagation(); onClick() }
  return (
    <button type="button" className={`ib ${showLabel ? 'with-label' : ''} ${primary ? 'primary' : ''} ${active ? 'on' : ''}`} title={label}
      aria-label={label} aria-pressed={active} disabled={disabled} onClick={click}
      onPointerDown={stop ? (e) => e.stopPropagation() : undefined}>
      <Icon size={16} strokeWidth={1.8} aria-hidden />
      {showLabel && <span>{label}</span>}
    </button>
  )
}

export function IconLink({ icon: Icon, label, href, showLabel }: { icon: LucideIcon; label: string; href: string; showLabel?: boolean }) {
  return (
    <a className={`ib ${showLabel ? 'with-label' : ''}`} href={href} target={/^https?:/.test(href) ? '_blank' : undefined} rel="noreferrer"
      title={label} aria-label={label} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <Icon size={16} strokeWidth={1.8} aria-hidden />
      {showLabel && <span>{label}</span>}
    </a>
  )
}

const MODE_ICON: Record<Mode, LucideIcon> = { light: Sun, dark: Moon, system: Monitor }

// Light, dark or match the system: a radio group, so Tab lands on the chosen one and arrows move the choice.
export function ModeSwitch({ mode, set }: { mode: Mode; set: (m: Mode) => void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!step) return
    e.preventDefault()
    const next = MODES[(MODES.indexOf(mode) + step + MODES.length) % MODES.length]
    set(next)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus()
  }
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Colour mode" onKeyDown={onKey}>
      {MODES.map((m) => {
        const Icon = MODE_ICON[m]
        return (
          <button key={m} type="button" role="radio" data-value={m} aria-checked={m === mode} aria-label={MODE_LABEL[m]} title={MODE_LABEL[m]}
            tabIndex={m === mode ? 0 : -1} onClick={() => set(m)}>
            <Icon size={16} strokeWidth={1.8} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

// Escape closes a dialog. It listens first (capture) and stops there, so a peek open underneath stays open.
export function useEscape(close: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])
}

// A whole number you can type freely: clearing it to type another doesn't snap back. Each valid number
// (at least `min`) goes out as you type; leaving the field with nothing valid shows the last one again.
export function NumberInput({ value, min = 1, onChange, ...rest }: {
  value: number; min?: number; onChange: (n: number) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'type'>) {
  const [text, setText] = useState(String(value))
  useEffect(() => { if (Number(text) !== value) setText(String(value)) }, [value])
  return (
    <input {...rest} type="number" inputMode="numeric" min={min} value={text}
      onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isInteger(n) && n >= min) onChange(n) }}
      onBlur={() => setText(String(value))} />
  )
}
