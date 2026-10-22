import { Plus, X } from 'lucide-react'
import { IconButton } from './ui'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from './lib'

export type Term = { id: string; title: string; cwd: string; account: string; exited: boolean; started: string }

// Terminal tabs. Each tab is a real shell (often `claude --resume …`) that keeps running when you leave the page.
export default function Terminals({ active, go, fail, show }: {
  active?: string; go: (id: string) => void; fail: (e: Error) => void; show: (t: Term) => boolean
}) {
  const [all, setTerms] = useState<Term[]>([])
  // Tabs outside the current context are hidden, except the one you just opened.
  const terms = all.filter((t) => t.id === active || show(t))
  const refresh = () => api('terminals').then(setTerms, fail)
  useEffect(() => { refresh() }, [active])
  const current = terms.find((t) => t.id === active) ?? terms[0]

  const close = (t: Term) => api(`terminals/${t.id}`, 'DELETE').then(() => { refresh(); if (t.id === current?.id) go('') }, fail)
  const shell = () => api('terminals', 'POST', { kind: 'shell' }).then(({ id }) => go(id), fail)

  return (
    <section className="pane terminals">
      <div className="term-tabs" role="tablist">
        {terms.map((t) => (
          <div key={t.id} role="tab" aria-selected={t.id === current?.id} className={`term-tab ${t.id === current?.id ? 'on' : ''} ${t.exited ? 'exited' : ''}`}>
            <button className="term-tab-title" onClick={() => go(t.id)} title={`${t.cwd} · ${t.account}`}>{t.title}</button>
            <IconButton icon={X} label={`Close ${t.title}`} onClick={() => close(t)} />
          </div>
        ))}
        <IconButton icon={Plus} label="Shell" showLabel onClick={shell} />
      </div>
      {current
        ? <XTerm key={current.id} term={current} />
        : <p className="muted empty">No terminals yet. Open one from an agent (<b>open here</b>), a task (<b>▶ Start here</b>), or a project (<b>Terminal</b>).</p>}
    </section>
  )
}

export function XTerm({ term }: { term: Term }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const css = getComputedStyle(document.documentElement)
    const v = (n: string) => css.getPropertyValue(n).trim()
    const xterm = new Terminal({
      fontFamily: '"MesloLGS NF", "MesloLGS Nerd Font", ui-monospace, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: v('--surface'), foreground: v('--text'), cursor: v('--accent'), selectionBackground: v('--border') },
    })
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
