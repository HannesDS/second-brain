// Integrations page: whether each outside service works, when it last ran, and where it is configured.
// Only names, paths and hosts reach the browser, never tokens or secret calendar addresses.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { INDEX, MODEL as EMBED_MODEL, OLLAMA } from '../lib/rag.mjs'
import { ROOT, VAULT } from '../lib/vault.mjs'
import { ACCOUNTS, listAgents } from './agents'
import { CALENDARS_FILE, checkFeeds } from './calendar'
import { WORKBENCH_ACCOUNT } from './claude'
import { WHISPER_MODEL } from './meetings'
import { status as syncStatus } from './sync'

const run = promisify(execFile)

export type Integration = { id: string; name: string; state: 'ok' | 'off' | 'error'; detail: string; lastRun: string; config: string[] }

const tilde = (p: string) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p)
const rel = (p: string) => path.relative(ROOT, p)
const mtime = (f: string) => (fs.existsSync(f) ? fs.statSync(f).mtime.toISOString() : '')

// Full path of a command on the board's PATH (what the server will actually run), or ''.
export function onPath(bin: string, PATH = process.env.PATH ?? '') {
  for (const dir of PATH.split(path.delimiter).filter(Boolean)) {
    const f = path.join(dir, bin)
    try { fs.accessSync(f, fs.constants.X_OK); return f } catch { /* not here */ }
  }
  return ''
}

// "NOTION_TOKEN set · NOTION_USER_ID missing": which variables are filled in, not what they hold.
export const envVars = (names: string[]) => names.map((n) => `${n} ${process.env[n] ? 'set' : 'missing'}`).join(' · ')

export function notion(): Integration {
  const base = { id: 'notion', name: 'Notion', lastRun: syncStatus.lastRun, config: [`.env.local: ${envVars(['NOTION_TOKEN', 'NOTION_ROADMAP_DB', 'NOTION_USER_ID', 'NOTION_DEFAULT_PROJECT'])}`] }
  // The sync still runs (for GitHub) without a token; that isn't a Notion run.
  if (!process.env.NOTION_TOKEN) return { ...base, state: 'off', lastRun: '', detail: 'Set NOTION_TOKEN in .env.local to sync Roadmap stories.' }
  if (syncStatus.notion === 'error' || syncStatus.error) return { ...base, state: 'error', detail: syncStatus.error }
  return { ...base, state: 'ok', detail: 'Pulls Roadmap stories assigned to you, pushes status changes of linked tasks.' }
}

async function github(): Promise<Integration> {
  const gh = onPath('gh')
  const base = { id: 'github', name: 'GitHub', lastRun: syncStatus.lastRun, config: [gh ? `gh CLI: ${tilde(gh)}, signed in with gh auth login` : 'gh CLI: not installed', "Repos: each project's repos field"] }
  if (!gh) return { ...base, state: 'off', detail: 'Install the GitHub CLI (brew install gh) and run gh auth login.' }
  try {
    await run(gh, ['auth', 'status'], { timeout: 10_000 })
  } catch (e: any) {
    // gh lists hosts first; the line that says what's wrong comes after.
    const lines = String(e.stderr || e.stdout || e.message).split('\n').map((l) => l.trim().replace(/^X\s+/, '')).filter(Boolean)
    const why = lines.find((l) => /fail|not logged|invalid|expired|error/i.test(l)) ?? lines[0]
    return { ...base, state: 'error', detail: `gh auth status: ${why}` }
  }
  if (syncStatus.github.startsWith('error')) return { ...base, state: 'error', detail: syncStatus.github }
  return { ...base, state: 'ok', detail: 'Fills in the PR of a task’s branch and marks the task done once it is merged.' }
}

async function calendars(): Promise<Integration> {
  const feeds = await checkFeeds()
  const at = Math.max(0, ...feeds.map((f) => f.at))
  const base = { id: 'calendars', name: 'Google calendars', lastRun: at ? new Date(at).toISOString() : '', config: [`${rel(CALENDARS_FILE)} (not in git): ${feeds.map((f) => f.label).join(', ') || 'no feeds'}`] }
  if (!feeds.length) return { ...base, state: 'off', detail: 'No calendar connected: add the secret iCal address of each Google account.' }
  const failed = feeds.filter((f) => f.error)
  if (failed.length) return { ...base, state: 'error', detail: failed.map((f) => `${f.label}: ${f.error}`).join('; ') }
  return { ...base, state: 'ok', detail: `${feeds.length} calendar${feeds.length === 1 ? '' : 's'} on My day and the Calendar, refreshed every 5 minutes.` }
}

function claude(): Integration {
  const bin = onPath('claude')
  const agents = listAgents()
  const base = {
    id: 'claude', name: 'Claude accounts', lastRun: agents[0]?.updated ?? '',
    config: [...ACCOUNTS.map(([a, dir]) => `${a}: ~/${dir}${a === WORKBENCH_ACCOUNT ? ' (workbench runs)' : ''}`), "Per project: the project's account field"],
  }
  const missing = ACCOUNTS.filter(([, dir]) => !fs.existsSync(path.join(os.homedir(), dir))).map(([a]) => a)
  if (!bin) return { ...base, state: 'error', detail: 'The claude CLI is not on the board’s PATH.' }
  if (missing.length) return { ...base, state: 'error', detail: `No config folder for ${missing.join(', ')}: sign in once with that account.` }
  const last = ACCOUNTS.map(([a]) => `${a} ${agents.some((x) => x.account === a) ? 'active in the last 3 days' : 'no recent sessions'}`)
  return { ...base, state: 'ok', detail: `${tilde(bin)}. ${last.join(', ')}.` }
}

export async function ollama(): Promise<Integration> {
  const base = { id: 'ollama', name: 'Ollama (RAG)', lastRun: mtime(INDEX), config: [`OLLAMA_URL: ${OLLAMA}${process.env.OLLAMA_URL ? '' : ' (default)'}`, `Model: ${EMBED_MODEL}`, `Index: ${rel(INDEX)}`] }
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) throw new Error(`Ollama ${res.status}`)
    const { models = [] } = await res.json()
    if (!models.some((m: { name: string }) => m.name.split(':')[0] === EMBED_MODEL)) {
      return { ...base, state: 'error', detail: `Model missing: run ollama pull ${EMBED_MODEL}. Search falls back to plain text.` }
    }
  } catch (e: any) {
    return { ...base, state: 'error', detail: `Not reachable (${e.message}): search falls back to plain text. Start it with ollama serve.` }
  }
  return { ...base, state: 'ok', detail: 'Embeds the vault for search and for the context the chat gets.' }
}

export function whisper(): Integration {
  const tools = { 'whisper-cli': onPath('whisper-cli'), ffmpeg: onPath('ffmpeg') }
  const transcripts = path.join(VAULT, 'transcripts')
  const latest = fs.existsSync(transcripts) ? fs.readdirSync(transcripts).map((f) => mtime(path.join(transcripts, f))).sort().at(-1) : ''
  const base = {
    id: 'whisper', name: 'Whisper', lastRun: latest ?? '',
    config: [`WHISPER_MODEL: ${tilde(WHISPER_MODEL)}${process.env.WHISPER_MODEL ? '' : ' (default)'}`, ...Object.entries(tools).map(([k, v]) => `${k}: ${v ? tilde(v) : 'not installed'}`)],
  }
  const missing = [...Object.entries(tools).filter(([, v]) => !v).map(([k]) => k), ...(fs.existsSync(WHISPER_MODEL) ? [] : ['the model file'])]
  if (missing.length) return { ...base, state: 'error', detail: `Missing ${missing.join(', ')}: meetings can't be transcribed.` }
  return { ...base, state: 'ok', detail: 'Transcribes meeting recordings locally.' }
}

export const integrations = () => Promise.all([notion(), github(), calendars(), claude(), ollama(), whisper()])
