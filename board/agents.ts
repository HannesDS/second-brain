// Agents overview: hook-reported state (state/agents/*.json), plus a transcript scan so
// sessions that started before the hooks were installed still show up.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from '../lib/vault.mjs'

export const AGENTS_DIR = path.join(ROOT, 'state', 'agents')
export const ACCOUNTS: [string, string][] = [['dm', '.claude'], ['personal', '.claude-personal']]
const RECENT_MS = 3 * 24 * 3600 * 1000
// An inferred "waiting for you" older than this is more likely a finished session.
const WAITING_MS = 12 * 3600 * 1000

type Agent = Record<string, any>

// The events in the last (or first) bytes of a transcript; the cut-off line is skipped.
function read(file: string, { bytes = 128 * 1024, head = false } = {}) {
  const fd = fs.openSync(file, 'r')
  const size = fs.fstatSync(fd).size
  const len = Math.min(size, bytes)
  const buf = Buffer.alloc(len)
  fs.readSync(fd, buf, 0, len, head ? 0 : size - len)
  fs.closeSync(fd)
  return buf.toString('utf8').split('\n').flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
}

// Infers state from the end of a transcript: a final assistant text means it waits for you.
function fromTranscript(file: string, account: string): Agent | undefined {
  const talk = (e: any) => e.type === 'user' || e.type === 'assistant'
  const events = read(file).filter(talk)
  const last = events.at(-1)
  // Headless runs (claude -p, SDK) never wait for a person.
  if (!last || String(last.entrypoint ?? '').startsWith('sdk')) return
  const text = (c: any) => (Array.isArray(c) ? c.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n') : String(c ?? ''))
  // First thing the person typed, skipping injected reminders and command wrappers. Read from the start,
  // so the title doesn't change as the transcript grows.
  const prompt = (evs: any[]) => evs.map((e) => (e.type === 'user' ? text(e.message?.content).trim() : '')).find((t) => t && !t.startsWith('<'))
  const firstPrompt = prompt(read(file, { bytes: 64 * 1024, head: true }).filter(talk)) ?? prompt(events) ?? ''
  const lastText = [...events].reverse().find((e) => e.type === 'assistant' && text(e.message?.content).trim())
  const pendingTool = last.type === 'assistant' && last.message?.content?.some?.((c: any) => c.type === 'tool_use')
  // File times are unreliable (the desktop app rewrites transcripts); use the last message's time.
  const at = new Date(last.timestamp ?? fs.statSync(file).mtime)
  return {
    id: path.basename(file, '.jsonl'),
    cwd: last.cwd ?? '',
    account,
    state: Date.now() - at.getTime() > WAITING_MS ? 'idle' : pendingTool || last.type === 'user' ? 'unknown' : 'needs-input',
    updated: at.toISOString(),
    title: String(firstPrompt).split('\n')[0].slice(0, 90),
    message: lastText ? text(lastText.message.content).slice(-400) : '',
    inferred: true,
  }
}

export function listAgents(): Agent[] {
  const byId = new Map<string, Agent>()
  for (const [account, dir] of ACCOUNTS) {
    const projects = path.join(os.homedir(), dir, 'projects')
    if (!fs.existsSync(projects)) continue
    for (const p of fs.readdirSync(projects)) {
      const full = path.join(projects, p)
      if (!fs.statSync(full).isDirectory()) continue
      for (const f of fs.readdirSync(full)) {
        if (!f.endsWith('.jsonl')) continue
        const file = path.join(full, f)
        if (Date.now() - fs.statSync(file).mtimeMs > RECENT_MS) continue
        try { const a = fromTranscript(file, account); if (a) byId.set(a.id, a) } catch { /* unreadable */ }
      }
    }
  }
  if (fs.existsSync(AGENTS_DIR)) {
    for (const f of fs.readdirSync(AGENTS_DIR)) {
      try {
        const a = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, f), 'utf8'))
        byId.set(a.id, { ...byId.get(a.id), ...a, inferred: false })
      } catch { /* half-written */ }
    }
  }
  return [...byId.values()]
    .filter((a) => a.source !== 'board-chat' && !(a.state === 'ended' && Date.now() - Date.parse(a.updated) > 24 * 3600 * 1000))
    .map((a) => settle(a))
    .sort((a, b) => b.updated.localeCompare(a.updated))
}

// A session killed without its SessionEnd hook keeps its last state: after WAITING_MS it is idle.
export function settle(a: Agent, now = Date.now()): Agent {
  return ['working', 'needs-input'].includes(a.state) && now - Date.parse(a.updated) > WAITING_MS ? { ...a, state: 'idle' } : a
}
