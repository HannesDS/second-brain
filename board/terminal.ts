// Real terminals inside the workbench: a pty per tab, streamed over a WebSocket on /term.
// Terminals outlive page switches and reloads (scrollback is replayed on reconnect).
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import pty, { type IPty } from 'node-pty'
import { WebSocketServer, type WebSocket } from 'ws'
import { cleanEnv } from './claude'

type Term = { id: string; title: string; cwd: string; account: string; agent?: string; task?: string; proc: IPty; buffer: string; sockets: Set<WebSocket>; exited: boolean; started: string }

// On globalThis so terminals survive Vite re-importing this module after a config change.
const g = globalThis as { __secondBrainTerms?: Map<string, Term> }
const terms = (g.__secondBrainTerms ??= new Map())
const SCROLLBACK = 200_000
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// agent: the Claude session this terminal resumes. Asking again for the same session returns the open tab.
export function openTerminal({ title, cwd, account, run, taskId, agent }: { title: string; cwd: string; account: string; run?: string; taskId?: string; agent?: string }) {
  const existing = agent && [...terms.values()].find((t) => t.agent === agent && !t.exited)
  if (existing) return existing.id
  const env = cleanEnv(account, { TERM: 'xterm-256color', COLORTERM: 'truecolor', ...(taskId ? { TASK_ID: taskId } : {}) })
  const shell = process.env.SHELL || '/bin/zsh'
  // After the command ends you land in a normal shell in the same folder.
  const args = run ? ['-lc', `${run}; exec ${quote(shell)} -l`] : ['-l']
  const proc = pty.spawn(shell, args, { name: 'xterm-256color', cols: 120, rows: 32, cwd, env })
  const id = Math.random().toString(36).slice(2, 10)
  const t: Term = { id, title, cwd, account, agent, task: taskId, proc, buffer: '', sockets: new Set(), exited: false, started: new Date().toISOString() }
  proc.onData((d) => {
    t.buffer = (t.buffer + d).slice(-SCROLLBACK)
    for (const s of t.sockets) s.send(d)
  })
  proc.onExit(() => {
    t.exited = true
    for (const s of t.sockets) s.send('\r\n\x1b[2m[terminal closed]\x1b[0m\r\n')
  })
  terms.set(id, t)
  return id
}

export const listTerminals = () =>
  [...terms.values()].map(({ id, title, cwd, account, agent, task, exited, started }) => ({ id, title, cwd, account, agent, task, exited, started }))

export function closeTerminal(id: string) {
  const t = terms.get(id)
  if (!t) return
  if (!t.exited) t.proc.kill()
  for (const s of t.sockets) s.close()
  terms.delete(id)
}

// Only the workbench page itself may connect: a terminal is a shell on this machine (and /listen writes the vault).
export function trusted(req: IncomingMessage) {
  const host = req.headers.host ?? ''
  const origin = req.headers.origin
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) && !!origin && new URL(origin).host === host
}

export function attachTerminals(server: Server) {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://local')
    if (url.pathname !== '/term') return // Vite's own HMR socket
    const t = terms.get(url.searchParams.get('id') ?? '')
    if (!trusted(req) || !t) return void socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => {
      t.sockets.add(ws)
      ws.send(t.buffer)
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw))
          if (t.exited) return
          if (msg.type === 'input') t.proc.write(String(msg.data))
          if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) t.proc.resize(Math.floor(msg.cols), Math.floor(msg.rows))
        } catch { /* ignore malformed frames */ }
      })
      ws.on('close', () => t.sockets.delete(ws))
    })
  })
}
