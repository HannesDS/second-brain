// Vite plugin: JSON API over the vault, plus a push to the browser when files change.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { context as ragContext, refresh as ragRefresh, refreshSoon as ragRefreshSoon } from '../lib/rag.mjs'
import { ID, ROOT, VAULT, listDocs, nextTaskId, readDoc, today, updateDoc, writeDoc } from '../lib/vault.mjs'
import { AGENTS_DIR, listAgents } from './agents'
import { addFeed, events, listFeeds, removeFeed, warmCalendars } from './calendar'
import { WORKBENCH_ACCOUNT, claudeEnv } from './claude'
import { createMeeting, readTranscript, transcribeChunk } from './meetings'
import { applyFiling, createNote, listNotes, proposeFiling, saveDoc, vaultPath } from './notes'
import { asList, expand, workdir } from './repos'
import { startReady } from './queue'
import { search } from './search'
import { onTaskChanged, startSync, status as syncStatus, syncNow } from './sync'
import { attachTerminals, closeTerminal, listTerminals, openTerminal } from './terminal'

// Secrets (NOTION_TOKEN, ...) live in .env.local, which git ignores.
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
    if (kind === 'calendars') return listFeeds()
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
  if (kind === 'calendars' && method === 'POST') { await addFeed(body.label, body.url); return listFeeds() }
  if (kind === 'calendars' && method === 'DELETE') { removeFeed(Number(id)); return listFeeds() }
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
  if (kind === 'notes' && method === 'POST') return { path: createNote(String(body.title ?? ''), String(body.body ?? '')) }
  if (kind === 'doc' && method === 'PUT') { saveDoc(String(body.path), body.body === undefined ? undefined : String(body.body), body.data ?? {}); return { ok: true } }
  if (kind === 'meetings' && method === 'POST') return createMeeting(body)
  if (kind === 'file' && method === 'POST') return id === 'apply' ? { done: applyFiling(body.path, body.actions) } : proposeFiling(body.path, String(body.answers ?? ''))
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

// Opens a terminal tab: resume an agent session, or start Claude / a shell for a project or task.
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

function terminalFor(body: { kind: string; agent?: string; project?: string; task?: string; prompt?: string }) {
  if (body.kind === 'autopilot') return autopilot(String(body.task))
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
  // An optional first prompt starts the agent working right away; without one it waits for you.
  const prompt = String(body.prompt ?? '').trim()
  const run = body.kind === 'claude' ? (prompt ? `claude ${shellQuote(prompt)}` : 'claude') : undefined
  return openTerminal({ title, cwd, account: p?.data.account || WORKBENCH_ACCOUNT, run, taskId: t?.name })
}

// Autopilot: Claude solves a task on its own in a visible terminal, in auto permission mode, on its own
// worktree and branch so several runs don't collide. The task reaches it through the SessionStart hook;
// the project's "## Autopilot" section says how this project wants the work done.
const AUTOPILOT_DEFAULT = 'Read the code the change touches, make the change, run the checks the repo documents (tests, lint, build) and commit.'

// Runs autopilot started, until their task leaves ready/wip (a task stays "ready" for a few seconds,
// until its session starts). On globalThis so a Vite re-import doesn't start them twice.
const g = globalThis as { __secondBrainLaunched?: Map<string, string> }
const launched = (g.__secondBrainLaunched ??= new Map())
const AUTOPILOT_MAX = 3

function autopilot(task: string) {
  const t = listDocs('tasks').find((d) => d.name === task)
  if (!t) throw new Error(`unknown task ${task}`)
  const prev = launched.get(t.name)
  if (prev && ['ready', 'wip'].includes(t.data.status) && listTerminals().some((x) => x.id === prev && !x.exited)) return prev
  const p = listDocs('projects').find((d) => d.name === String(t.data.project ?? '').replace(/\[|\]/g, ''))
  const repo = workdir(p, t)
  // A worktree only in a repo the task or project names, never in the workbench folder it falls back to.
  const inRepo = [t.data.repo, ...asList(p?.data.repos)].filter(Boolean).map(expand).includes(repo) && fs.existsSync(path.join(repo, '.git'))
  const cwd = inRepo ? worktreeFor(repo, t.name.toLowerCase()) : repo
  const workflow = p?.body.match(/^## Autopilot[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1].trim() || AUTOPILOT_DEFAULT
  const prompt = [
    `Autopilot: solve task ${t.name} ("${t.data.title}") end to end, without waiting for me. The task is in your context.`,
    inRepo ? 'You are in your own git worktree on its own branch: work and commit there, and leave the main checkout alone.' : '',
    `How this project wants the work done:\n${workflow}`,
    `When you are done, in ${VAULT}/tasks/${t.name}.md set status: review and branch: <your branch> (and pr: <url> if you opened one), and add a short "## Result" section to the body: what changed, how you verified it, anything left open.`,
    'If you hit a decision only I can make, write the question under "## Questions" in the task body, set status: blocked, and stop.',
  ].filter(Boolean).join('\n\n')
  // The vault is outside the worktree, and the run must update its task there.
  const flags = `--permission-mode auto --add-dir ${shellQuote(VAULT)} --name ${shellQuote(`${t.name} ${t.data.title}`)}`
  const id = openTerminal({ title: `🚀 ${t.name} ${t.data.title}`, cwd, account: p?.data.account || WORKBENCH_ACCOUNT, run: `claude ${flags} ${shellQuote(prompt)}`, taskId: t.name })
  launched.set(t.name, id)
  return id
}

// The run's worktree and branch (autopilot/<task>), from the commit the checkout is on now: `claude --worktree`
// starts from origin's default branch, which misses unpushed work and local-only branches. A rerun reuses both.
function worktreeFor(repo: string, name: string) {
  const dir = path.join(repo, '.claude', 'worktrees', name)
  if (fs.existsSync(dir)) return dir
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  const branch = `autopilot/${name}`
  const exists = (() => { try { git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); return true } catch { return false } })()
  git('worktree', 'add', ...(exists ? [dir, branch] : ['-b', branch, dir, 'HEAD']))
  // Keep the worktrees out of the repo's own status, also in repos that don't ignore .claude/.
  const exclude = path.join(git('rev-parse', '--git-common-dir').trim().replace(/^(?!\/)/, `${repo}/`), 'info', 'exclude')
  const lines = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
  if (!lines.split('\n').includes('.claude/worktrees/')) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true })
    fs.appendFileSync(exclude, `${lines && !lines.endsWith('\n') ? '\n' : ''}.claude/worktrees/\n`)
  }
  return dir
}

// Runs on every task file change, so the ready queue works from the board, Obsidian or a skill alike,
// and the next task starts when a run moves its task on.
let frontierTimer: NodeJS.Timeout | undefined
function runFrontierSoon() {
  clearTimeout(frontierTimer)
  frontierTimer = setTimeout(runFrontier, 1000)
}

function runFrontier() {
  const tasks = listDocs('tasks')
  const status = new Map(tasks.map((t) => [t.name, t.data.status]))
  const open = new Set(listTerminals().filter((x) => !x.exited).map((x) => x.id))
  for (const [task, term] of launched) if (!['ready', 'wip'].includes(status.get(task)) || !open.has(term)) launched.delete(task)
  startReady(tasks, new Set(launched.keys()), AUTOPILOT_MAX, autopilot)
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
        if (f.startsWith(path.join(VAULT, 'tasks'))) { onTaskChanged(f); runFrontierSoon() }
      }
      server.watcher.on('add', notify).on('change', notify).on('unlink', notify)
      startSync()
      runFrontierSoon()
      warmCalendars()
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
        // Teach reports are HTML the agent wrote: sandboxed so they cannot script against the API.
        const report = req.url?.match(/^\/reports\/([\w.-]+\.html)$/)?.[1]
        if (report) {
          const f = path.join(VAULT, 'reports', report)
          if (!fs.existsSync(f)) { res.statusCode = 404; return void res.end('report not found') }
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.setHeader('content-security-policy', 'sandbox')
          return void res.end(fs.readFileSync(f))
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
