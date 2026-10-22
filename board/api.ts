// Vite plugin: JSON API over the vault, plus a push to the browser when files change.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { context as ragContext, refresh as ragRefresh, refreshSoon as ragRefreshSoon, search as ragSearch } from '../lib/rag.mjs'
import { ID, ROOT, VAULT, listDocs, nextTaskId, readDoc, today, updateDoc, writeDoc } from '../lib/vault.mjs'
import { AGENTS_DIR, listAgents } from './agents'
import { events } from './calendar'
import { WORKBENCH_ACCOUNT, claudeEnv } from './claude'
import { createMeeting, readTranscript, transcribeChunk } from './meetings'
import { applyFiling, createNote, listNotes, proposeFiling, saveDoc, vaultPath } from './notes'
import { onTaskChanged, startSync, status as syncStatus, syncNow } from './sync'
import { attachTerminals, closeTerminal, listTerminals, openTerminal } from './terminal'

// Secrets (NOTION_TOKEN, CALENDAR_ICS) live in .env.local, which git ignores.
try { process.loadEnvFile(path.join(ROOT, '.env.local')) } catch { /* optional */ }

const TASK_DEFAULTS = {
  status: 'todo', priority: 'p2', order: 0, type: 'code', blocked_by: '', repo: '', branch: '', pr: '',
  sessions: [], meetings: [], sources: [], due: '',
}

async function readJson(req: IncomingMessage) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

function file(dir: string, id: string) {
  if (!ID.test(id)) throw new Error(`invalid id: ${id}`)
  return path.join(VAULT, dir, `${id}.md`)
}

// Semantic hits first (local embeddings), then plain-text matches the embeddings missed.
// Falls back to plain text when Ollama isn't running.
async function search(q: string) {
  const text = textSearch(q)
  try {
    const best = new Map<string, any>()
    for (const h of await ragSearch(q, 30, 1)) {
      if (h.score < 0.5) continue
      const [dir, f] = h.path.split('/')
      best.set(h.path, { path: h.path, dir, name: f.replace(/\.md$/, ''), title: h.text.split('\n')[0].replace(/ \(.*$/, ''), score: h.score, snippet: h.text.split('\n').slice(1).join(' ').slice(0, 200) })
    }
    for (const t of text) if (!best.has(t.path)) best.set(t.path, t)
    return [...best.values()].slice(0, 25)
  } catch {
    return text
  }
}

function textSearch(q: string) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return ['tasks', 'notes', 'inbox', 'meetings', 'projects'].flatMap((dir) => listDocs(dir).map((d) => {
    const text = `${d.data.title ?? d.data.name ?? d.name}\n${d.body}`
    const lower = text.toLowerCase()
    const score = terms.reduce((s, t) => s + (lower.split(t).length - 1), 0)
    const at = lower.indexOf(terms[0])
    return { path: `${dir}/${d.name}.md`, dir, name: d.name, title: d.data.title ?? d.name, score, snippet: at < 0 ? '' : text.slice(Math.max(0, at - 60), at + 140) }
  })).filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, 25)
}

async function handle(req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://local')
  const [, kind, id] = url.pathname.split('/')
  const method = req.method

  if (method === 'GET') {
    if (kind === 'data') return { root: ROOT, vault: VAULT, projects: listDocs('projects'), tasks: listDocs('tasks'), meetings: listDocs('meetings') }
    if (kind === 'agents') return listAgents()
    if (kind === 'notes') return listNotes()
    if (kind === 'doc') return readDoc(vaultPath(url.searchParams.get('path') ?? ''))
    if (kind === 'search') return await search(url.searchParams.get('q') ?? '')
    if (kind === 'sync') return syncStatus
    if (kind === 'terminals') return listTerminals()
    if (kind === 'transcript') return { text: readTranscript(meetingName(url.searchParams.get('name'))) }
    if (kind === 'calendar') {
      return events(new Date(url.searchParams.get('from') ?? Date.now()), new Date(url.searchParams.get('to') ?? Date.now() + 30 * 864e5))
    }
  }
  const body = await readJson(req)

  if (method === 'POST' && kind === 'move') {
    for (const m of body as { id: string; status: string; order: number }[]) {
      updateDoc(file('tasks', m.id), { status: m.status, order: m.order })
    }
    return { ok: true }
  }
  if (method === 'POST' && kind === 'sync') { await syncNow(); return syncStatus }
  if (kind === 'terminals' && method === 'DELETE') { closeTerminal(id); return { ok: true } }
  if (kind === 'terminals' && method === 'POST') return { id: terminalFor(body) }
  if (kind === 'tasks') {
    const data = { ...body.data }
    if (data.title) data.aliases = [data.title]
    if (method === 'POST') {
      const newId = nextTaskId()
      writeDoc(file('tasks', newId), { id: newId, ...TASK_DEFAULTS, ...data, created: today(), updated: today() }, body.body ?? '')
      return { id: newId }
    }
    if (method === 'PUT') { updateDoc(file('tasks', id), data, body.body); return { id } }
  }
  if (kind === 'projects') {
    if (method === 'POST') {
      const f = file('projects', body.data.id)
      if (fs.existsSync(f)) throw new Error(`project ${body.data.id} already exists`)
      writeDoc(f, body.data, body.body ?? '')
      return { id: body.data.id }
    }
    if (method === 'PUT') { updateDoc(file('projects', id), body.data, body.body); return { id } }
  }
  if (kind === 'notes' && method === 'POST') return { path: createNote(String(body.title ?? '')) }
  if (kind === 'doc' && method === 'PUT') { saveDoc(String(body.path), body.body === undefined ? undefined : String(body.body), body.data ?? {}); return { ok: true } }
  if (kind === 'meetings' && method === 'POST') return createMeeting(body)
  if (kind === 'file' && method === 'POST') return id === 'apply' ? { done: applyFiling(body.path, body.actions) } : proposeFiling(body.path)
  throw new Error(`no route: ${method} ${req.url}`)
}

// A meeting note's name, checked against the file system (it ends up in a path).
function meetingName(name: unknown) {
  const n = String(name ?? '')
  if (!fs.existsSync(vaultPath(`meetings/${n}.md`))) throw new Error(`no meeting note "${n}"`)
  return n
}

// Raw audio upload: POST /api/transcribe?name=<meeting>&at=<iso>, body = one self-contained webm chunk.
async function transcribe(req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://local')
  const name = meetingName(url.searchParams.get('name'))
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 50 * 1024 * 1024) throw new Error('audio chunk too large')
    chunks.push(c)
  }
  return { text: await transcribeChunk(name, Buffer.concat(chunks), url.searchParams.get('at') ?? '') }
}

const expand = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir())
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : [])

// The folder Claude works in for a task or project: the task's repo, else the project's first existing repo.
function workdir(p?: { data: Record<string, any> }, t?: { data: Record<string, any> }) {
  return [t?.data.repo, ...asList(p?.data.repos)].filter(Boolean).map(expand).find((d) => fs.existsSync(d)) ?? ROOT
}

// Opens a terminal tab: resume an agent session, or start Claude / a shell for a project or task.
function terminalFor(body: { kind: string; agent?: string; project?: string; task?: string }) {
  if (body.kind === 'resume') {
    const a = listAgents().find((x) => x.id === body.agent)
    if (!a || !ID.test(a.id)) throw new Error('unknown agent session')
    const cwd = fs.existsSync(a.cwd) ? a.cwd : ROOT
    return openTerminal({ title: `↻ ${path.basename(cwd)}`, cwd, account: a.account || 'dm', run: `claude --resume ${a.id}`, taskId: a.task || undefined, agent: a.id })
  }
  const t = body.task ? listDocs('tasks').find((d) => d.name === body.task) : undefined
  const p = listDocs('projects').find((d) => d.name === (body.project || String(t?.data.project ?? '').replace(/\[|\]/g, '')))
  const cwd = workdir(p, t)
  const title = t ? `${t.name} ${t.data.title}` : p ? String(p.data.name ?? p.name) : 'shell'
  return openTerminal({ title, cwd, account: p?.data.account || WORKBENCH_ACCOUNT, run: body.kind === 'claude' ? 'claude' : undefined, taskId: t?.name })
}

// Runs one chat turn as `claude -p` in the project's repo, with the project's account,
// and streams Claude's stream-json events back as NDJSON. No project = the general chat,
// which runs in this repo on the personal account and can reach the whole vault.
async function chat(req: IncomingMessage, res: ServerResponse) {
  const { project, task, message, sessionId } = await readJson(req)
  const p = project ? listDocs('projects').find((d) => d.name === project) : undefined
  const t = task ? listDocs('tasks').find((d) => d.name === task) : undefined
  if ((project && !p) || !String(message ?? '').trim() || (task && !t) || (sessionId && !ID.test(sessionId))) {
    res.statusCode = 400
    return res.end(JSON.stringify({ error: 'unknown project or task, or empty message' }))
  }
  const cwd = workdir(p, t)
  const account = p?.data.account || WORKBENCH_ACCOUNT
  const env = claudeEnv(account, t ? { TASK_ID: t.name } : {})

  const context = (p
    ? `You are chatting from the user's second-brain board about project "${p.data.name ?? p.name}" (vault: ${VAULT}).`
    : `You are the general assistant of the user's second-brain workbench (vault: ${VAULT}). Projects are in projects/, tasks in tasks/, meetings in meetings/, notes in notes/ and inbox/. When the user shares a finding, propose which project or task it belongs to and add it after they agree.`)
    + (t ? ` The chat is about task ${t.name}: ${t.data.title} (file: ${VAULT}/tasks/${t.name}.md).` : '')
    + ' Use the task skill to create or update tasks. When grilling or sparring, ask one question at a time and record settled decisions in the task body under "## Decisions". Keep answers short.'
  const related = await ragContext(message)
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt',
    related ? `${context}\n\nPossibly relevant notes from the vault (retrieved by similarity; read the files for detail):\n${related}` : context]
  if (sessionId) args.push('--resume', sessionId)

  res.setHeader('content-type', 'application/x-ndjson')
  res.write(JSON.stringify({ type: 'meta', cwd, account }) + '\n')
  const child = spawn('claude', args, { cwd, env })
  let stderr = ''
  child.stdout.on('data', (c) => res.write(c))
  child.stderr.on('data', (c) => { stderr += c })
  child.on('error', (e) => { res.write(JSON.stringify({ type: 'error', error: e.message }) + '\n'); res.end() })
  child.on('close', (code) => {
    if (code) res.write(JSON.stringify({ type: 'error', error: stderr.trim() || `claude exited with ${code}` }) + '\n')
    res.end()
  })
  res.on('close', () => { if (!res.writableFinished) child.kill() })
  child.stdin.end(message)
}

export function vaultApi(): Plugin {
  return {
    name: 'vault-api',
    configureServer(server) {
      fs.mkdirSync(AGENTS_DIR, { recursive: true })
      server.watcher.add([VAULT, AGENTS_DIR])
      const notify = (f: string) => {
        if (f.startsWith(VAULT) && f.endsWith('.md')) { server.ws.send({ type: 'custom', event: 'vault-change' }); ragRefreshSoon() }
        if (f.startsWith(AGENTS_DIR)) server.ws.send({ type: 'custom', event: 'agents-change' })
        if (f.startsWith(path.join(VAULT, 'tasks'))) onTaskChanged(f)
      }
      server.watcher.on('add', notify).on('change', notify).on('unlink', notify)
      startSync()
      if (server.httpServer) attachTerminals(server.httpServer as import('node:http').Server)
      ragRefresh().catch((e: Error) => console.error(`rag: ${e.message} (search falls back to plain text)`))

      server.middlewares.use('/api', (req, res: ServerResponse) => {
        // Other websites must not drive the API (it writes files and runs Claude). Vite already checks Host.
        const origin = req.headers.origin
        if (origin && new URL(origin).host !== req.headers.host) {
          res.statusCode = 403
          return void res.end(JSON.stringify({ error: 'cross-origin request refused' }))
        }
        if (req.url === '/guide') {
          res.setHeader('content-type', 'text/markdown; charset=utf-8')
          return void res.end(readDoc(path.join(VAULT, 'notes/Guide.md')).body)
        }
        if (req.url?.startsWith('/transcribe') && req.method === 'POST') {
          return void transcribe(req)
            .then((out) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out)) })
            .catch((e) => { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })) })
        }
        if (req.url === '/chat' && req.method === 'POST') {
          return void chat(req, res).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) })
        }
        handle(req)
          .then((out) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out)) })
          .catch((e) => { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })) })
      })
    },
  }
}
