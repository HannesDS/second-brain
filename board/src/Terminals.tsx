import { Plus, RotateCw, Rocket, SquareTerminal, X, type LucideIcon } from 'lucide-react'
import { IconButton } from './ui'
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, tabKind, type TabKind } from './lib'
import { useDark } from './theme'

const TAB_ICON: Record<TabKind, LucideIcon> = { autopilot: Rocket, resumed: RotateCw, terminal: SquareTerminal }
const TAB_KIND: Record<TabKind, string> = { autopilot: 'Autopilot', resumed: 'Resumed session', terminal: 'Terminal' }

export type Term = { id: string; title: string; cwd: string; account: string; agent?: string; task?: string; exited: boolean; started: string }

// Terminal tabs. Each tab is a real shell (often `claude --resume …`) that keeps running when you leave the page.
// The list comes from the app, which also links each agent to its tab.
export default function Terminals({ all, refresh, active, go, fail, show }: {
  all: Term[]; refresh: () => Promise<unknown>; active?: string; go: (id: string) => void; fail: (e: Error) => void; show: (t: Term) => boolean
}) {
  // Tabs outside the current context are hidden, except the one you just opened.
  const terms = all.filter((t) => t.id === active || show(t))
  const current = terms.find((t) => t.id === active) ?? terms[0]

  const close = (t: Term) => api(`terminals/${t.id}`, 'DELETE').then(() => { refresh().catch(fail); if (t.id === current?.id) go('') }, fail)
  const shell = () => api('terminals', 'POST', { kind: 'shell' }).then(({ id }) => go(id), fail)

  return (
    <section className="pane terminals">
      <div className="term-tabs" role="tablist">
        {terms.map((t) => {
          const { kind: k, text } = tabKind(t.title)
          const Icon = TAB_ICON[k]
          const kind = TAB_KIND[k]
          return (
            <div key={t.id} role="tab" aria-selected={t.id === current?.id} className={`term-tab ${t.id === current?.id ? 'on' : ''} ${t.exited ? 'exited' : ''}`}>
              <button className="term-tab-title" onClick={() => go(t.id)} title={`${text}\n${kind} · ${t.cwd} · ${t.account}`}>
                <Icon size={14} strokeWidth={1.8} aria-label={kind} /><span className="term-tab-text">{text}</span>
              </button>
              <IconButton icon={X} label={`Close ${text}`} onClick={() => close(t)} />
            </div>
          )
        })}
        <IconButton icon={Plus} label="Shell" showLabel onClick={shell} />
      </div>
      {current
        ? <XTerm key={current.id} term={current} />
        : <p className="muted empty">No terminals yet. Open one from an agent in the list, from a task (<b>Start agent</b>), or with <b>Shell</b> above.</p>}
    </section>
  )
}

// The terminal's colours come from the tokens, read when it opens and again when the mode changes.
function termTheme() {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string) => css.getPropertyValue(n).trim()
  return { background: v('--surface'), foreground: v('--text'), cursor: v('--accent'), selectionBackground: v('--border') }
}

export function XTerm({ term }: { term: Term }) {
  const host = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal>(undefined)
  const dark = useDark()
  useEffect(() => { if (xtermRef.current) xtermRef.current.options.theme = termTheme() }, [dark])
  useEffect(() => {
    const xterm = new Terminal({
      fontFamily: '"MesloLGS NF", "MesloLGS Nerd Font", ui-monospace, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: termTheme(),
    })
    xtermRef.current = xterm
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.open(host.current!)
    fit.fit()
    xterm.focus()

    let ws: WebSocket | undefined
    let closed = false
    let retry: number
    const send = (msg: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)) }
    // Reconnects after the dev server restarts; the server replays the scrollback.
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/term?id=${term.id}`)
      ws.onopen = () => { xterm.reset(); send({ type: 'resize', cols: xterm.cols, rows: xterm.rows }) }
      ws.onmessage = (e) => xterm.write(e.data)
      ws.onclose = () => { if (!closed && !term.exited) retry = window.setTimeout(connect, 1500) }
    }
    connect()
    const input = xterm.onData((data) => send({ type: 'input', data }))
    const ro = new ResizeObserver(() => { fit.fit(); send({ type: 'resize', cols: xterm.cols, rows: xterm.rows }) })
    ro.observe(host.current!)
    return () => { closed = true; clearTimeout(retry); ro.disconnect(); input.dispose(); ws?.close(); xterm.dispose() }
  }, [term.id])

  return (
    <div className="term-wrap">
      <div className="muted term-meta">{term.cwd} · {term.account} account{term.exited ? ' · closed' : ''}</div>
      <div ref={host} className="term-host" />
    </div>
  )
}
