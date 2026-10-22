import type { LucideIcon } from 'lucide-react'
import type { MouseEvent } from 'react'

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
