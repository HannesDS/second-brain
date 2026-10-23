// Keeps tasks in step with the outside world while the board runs:
// - Notion: pulls Roadmap stories assigned to me, pushes status changes of linked tasks.
// - GitHub: fills in the PR of a task's branch; marks a task done when its PR is merged (which then pushes to Notion too).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { VAULT, listDocs, nextTaskId, readDoc, today, updateDoc, writeDoc } from '../lib/vault.mjs'
import { workdir } from './repos'

const run = promisify(execFile)
const API = 'https://api.notion.com/v1'
// The team board to pull my stories from, and my Notion user id (both in .env.local).
const ROADMAP_DB = () => process.env.NOTION_ROADMAP_DB ?? ''
const EVERY_MS = 5 * 60 * 1000

export const status = { notion: 'off', github: 'idle', lastRun: '', error: '' }

const pageId = (url: unknown) => String(url ?? '').replace(/-/g, '').match(/[0-9a-f]{32}/)?.[0]
const taskFile = (id: string) => path.join(VAULT, 'tasks', `${id}.md`)
const token = () => process.env.NOTION_TOKEN

async function notion(method: string, url: string, body?: unknown) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Notion-Version': '2022-06-28', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const out = await res.json()
  if (!res.ok) throw new Error(`Notion ${res.status}: ${out.message}`)
  return out
}

// Picks the Notion status option for a local status. todo and blocked are never pushed:
// Notion's own to-do stages (Inbox, Qualified, ...) carry team meaning I shouldn't overwrite.
type Group = { name: string; option_ids: string[] }
type Option = { id: string; name: string }
function pickOption(options: Option[], groups: Group[], local: string) {
  const inGroup = (g: RegExp) => {
    const ids = groups.find((x) => g.test(x.name))?.option_ids ?? []
    return options.filter((o) => ids.includes(o.id))
  }
  const prefer = (list: Option[], re: RegExp) => list.find((o) => re.test(o.name)) ?? list[0]
  if (local === 'done') return prefer(inGroup(/complete/i), /done/i)
  if (local === 'wip') return prefer(inGroup(/progress/i), /implement|progress|doing/i)
  if (local === 'review') return options.find((o) => /review|launch/i.test(o.name))
}

const schemaCache = new Map<string, { prop: string; options: Option[]; groups: Group[] }>()
async function statusSchema(databaseId: string) {
  if (!schemaCache.has(databaseId)) {
    const db = await notion('GET', `/databases/${databaseId}`)
    const [prop, def] = Object.entries<any>(db.properties).find(([, p]) => p.type === 'status') ?? []
    if (!prop) throw new Error(`database ${databaseId} has no status property`)
    schemaCache.set(databaseId, { prop, options: def.status.options, groups: def.status.groups })
  }
  return schemaCache.get(databaseId)!
}

export async function pushStatus(notionUrl: string, local: string) {
  const id = pageId(notionUrl)
  if (!token() || !id) return
  const page = await notion('GET', `/pages/${id}`)
  const schema = await statusSchema(page.parent.database_id)
  const option = pickOption(schema.options, schema.groups, local)
  if (!option || page.properties[schema.prop]?.status?.id === option.id) return
  await notion('PATCH', `/pages/${id}`, { properties: { [schema.prop]: { status: { id: option.id } } } })
}

function localStatus(name: string, groups: Group[], optionId: string) {
  const group = groups.find((g) => g.option_ids.includes(optionId))?.name ?? ''
  if (/complete/i.test(group)) return 'done'
  if (/launch|review/i.test(name)) return 'review'
  if (/progress/i.test(group)) return 'wip'
  return 'todo'
}

const PRIORITY: Record<string, string> = { High: 'p1', Medium: 'p2', Low: 'p3' }

async function pullRoadmap() {
  const me = process.env.NOTION_USER_ID
  if (!ROADMAP_DB() || !me) return
  const schema = await statusSchema(ROADMAP_DB())
  const projectIds = listDocs('projects').map((p) => p.name)
  const { results } = await notion('POST', `/databases/${ROADMAP_DB()}/query`, {
    filter: { property: 'Assign', people: { contains: me } },
    page_size: 100,
  })
  const tasks = listDocs('tasks')
  for (const page of results) {
    const p = page.properties
    const opt = p.Status?.status
    const remote = opt ? localStatus(opt.name, schema.groups, opt.id) : 'todo'
    const title = (p.Story?.title ?? []).map((t: any) => t.plain_text).join('').trim()
    const time = p.Time?.date
    const task = tasks.find((t) => pageId(t.data.notion) === page.id.replace(/-/g, ''))
    if (!task) {
      if (remote === 'done') continue
      const id = nextTaskId()
      // The story's Scope ("Portal") picks the project with that id; NOTION_DEFAULT_PROJECT otherwise.
      const scope = (p.Scope?.multi_select ?? []).map((s: any) => s.name.toLowerCase()).find((s: string) => projectIds.includes(s))
        ?? process.env.NOTION_DEFAULT_PROJECT ?? ''
      writeDoc(taskFile(id), {
        id, title, aliases: [title], project: scope ? `[[${scope}]]` : '', status: remote,
        priority: PRIORITY[p['Story priority']?.multi_select?.[0]?.name] ?? 'p2', order: 0,
        type: /^adr\b/i.test(title) ? 'research' : 'code', blocked_by: '', repo: '', branch: '', pr: '',
        sessions: [], meetings: [], sources: [], notion: page.url, start: time?.start ?? '', due: time?.end ?? '',
        created: today(), updated: today(),
      }, `Story from the Notion Product Roadmap (assigned to me).\n`)
      lastPushed.set(id, remote)
      continue
    }
    const patch: Record<string, unknown> = {}
    // Someone closed it in Notion: close it here. Other remote moves don't override my local status.
    if (remote === 'done' && task.data.status !== 'done') patch.status = 'done'
    if (time?.start && time.start !== task.data.start) patch.start = time.start
    if (time?.end && time.end !== task.data.due) patch.due = time.end
    if (Object.keys(patch).length && !task.error) {
      if (patch.status) lastPushed.set(task.name, String(patch.status))
      updateDoc(taskFile(task.name), patch)
    }
  }
}

// An agent records its branch but often not its PR: look the PR up by branch, in the task's repo.
// Merged ones count too, also for done tasks, so a PR merged before we saw it still lands on the task.
async function findPullRequests() {
  const projects = listDocs('projects')
  for (const t of listDocs('tasks')) {
    if (t.error || !t.data.branch || t.data.pr) continue
    const p = projects.find((d) => d.name === String(t.data.project ?? '').replace(/\[|\]/g, ''))
    try {
      const { stdout } = await run('gh', ['pr', 'list', '--head', t.data.branch, '--state', 'all', '--json', 'url,state'],
        { cwd: workdir(p, t), timeout: 20_000 })
      // Newest first; a PR closed without merging isn't the task's PR.
      const url = JSON.parse(stdout).find((x: { state: string }) => x.state !== 'CLOSED')?.url
      if (url) updateDoc(taskFile(t.name), { pr: url })
    } catch (e: any) {
      status.github = `error: ${e.message.split('\n')[0]}`
    }
  }
}

async function pollPullRequests() {
  for (const t of listDocs('tasks')) {
    if (t.error || t.data.status === 'done' || !/^https:\/\/github\.com\/.+\/pull\/\d+/.test(t.data.pr ?? '')) continue
    try {
      const { stdout } = await run('gh', ['pr', 'view', t.data.pr, '--json', 'state'], { timeout: 20_000 })
      if (JSON.parse(stdout).state === 'MERGED') updateDoc(taskFile(t.name), { status: 'done' })
    } catch (e: any) {
      status.github = `error: ${e.message.split('\n')[0]}`
    }
  }
}

// Status each linked task had when we last saw it; a change means: push it to Notion.
const lastPushed = new Map<string, string>()

export async function onTaskChanged(file: string) {
  const id = path.basename(file, '.md')
  // Deleted (or renamed away): nothing to push. Reading it would throw and take the server down.
  if (!fs.existsSync(file)) return void lastPushed.delete(id)
  const { data, error } = readDoc(file)
  if (error || !data.notion || !data.status || lastPushed.get(id) === data.status) return
  lastPushed.set(id, data.status)
  try { await pushStatus(data.notion, data.status) } catch (e: any) { status.error = e.message }
}

export async function syncNow() {
  status.lastRun = new Date().toISOString()
  status.error = ''
  try {
    if (token()) { await pullRoadmap(); status.notion = 'ok' } else status.notion = 'off: set NOTION_TOKEN in .env.local'
  } catch (e: any) {
    status.notion = 'error'
    status.error = e.message
  }
  status.github = 'ok'
  await findPullRequests()
  await pollPullRequests()
}

export function startSync() {
  for (const t of listDocs('tasks')) if (t.data.notion) lastPushed.set(t.name, t.data.status)
  syncNow()
  // Vite re-imports this module when the config changes; keep one timer per process.
  const g = globalThis as { __secondBrainSync?: NodeJS.Timeout }
  clearInterval(g.__secondBrainSync)
  g.__secondBrainSync = setInterval(syncNow, EVERY_MS)
}
