export type Fields = Record<string, any>
export type Doc = { name: string; data: Fields; body: string; error?: string }
export type Vault = { root: string; vault: string; projects: Doc[]; tasks: Doc[]; meetings: Doc[] }

export const STATUSES = ['todo', 'wip', 'review', 'blocked', 'done']
export const LABELS: Record<string, string> = { todo: 'To do', wip: 'In progress', review: 'Review', blocked: 'Blocked', done: 'Done', '?': 'Unknown status' }
export const PRIORITIES = ['p0', 'p1', 'p2', 'p3']
// Files keep p0-p3 (short, sortable); people see words.
export const PRIO_LABEL: Record<string, string> = { p0: 'Urgent', p1: 'High', p2: 'Normal', p3: 'Low' }
export const prioLabel = (p: unknown) => PRIO_LABEL[String(p)] ?? 'Normal'
export const TYPES = ['code', 'pr-review', 'meeting', 'research', 'admin']
export const CONTEXTS = ['dataminded', 'personal']
export const LIST_FIELDS = ['sessions', 'meetings', 'sources']

// Who a transcript line is from: your microphone, or the call's audio (everyone else).
export const SPEAKERS = { me: 'Me', others: 'Others' } as const
export type Speaker = keyof typeof SPEAKERS

// "[[portal|Portal]]" -> "portal"
export const unlink = (v: unknown) => String(v ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0]
export const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : [])
export const columnOf = (t: Doc) => (STATUSES.includes(t.data.status) ? t.data.status : '?')
export const obsidian = (p: string) => `obsidian://open?path=${encodeURIComponent(p)}`
// A PR's teach report is saved as reports/<date>-<task id>-pr.html and linked from the task body.
export const prReport = (t: Doc) => t.body.match(new RegExp(`reports/([\\w.-]*${t.name}-pr\\.html)`, 'i'))?.[1]
export const teachPrompt = (t: Doc, vault: string) => `Teach me the pull request of this task (${t.data.pr}) with the teach skill: what it changes, why, and the concepts I might not know, with diagrams. `
  + `Save the report as ${vault}/reports/${todayISO()}-${t.name.toLowerCase()}-pr.html (this exact name, not a concept slug) and link it from the task under "## Reports".`
export const byOrder = (a: Doc, b: Doc) => (Number(a.data.order) || 0) - (Number(b.data.order) || 0) || a.name.localeCompare(b.name)
// Latest finished first. Tasks done before `completed` was stamped fall back to their last update.
const finished = (t: Doc) => String(t.data.completed ?? t.data.updated ?? '')
export const byFinished = (a: Doc, b: Doc) => finished(b).localeCompare(finished(a)) || b.name.localeCompare(a.name)

// Names this browser tab to the server, so the tab can skip the reload for a drop it already shows.
export const TAB = crypto.randomUUID()

// Loads the vault without undoing a drop the files don't have yet. A load waits for the drops still being
// written (the server writes a move as soon as it reads it, so each answers or fails); one already on its
// way when a drop comes is asked again. A failed drop reloads, to show what the files really say: `dropped` hands
// back that reload, so its own failure can be shown too. Only the latest load is shown: an older one that
// answers late would put back what the newer one already replaced.
export function loader<T>(fetch: () => Promise<T>, set: (v: T) => void) {
  const writing = new Set<Promise<void>>()
  let drops = 0
  let loads = 0
  const load = (): Promise<void> => {
    const at = drops
    const own = ++loads
    return Promise.all(writing).then(fetch).then((v) => {
      if (own !== loads) return
      if (at === drops) set(v); else return load()
    })
  }
  return {
    load,
    dropped(v: T, write: Promise<unknown>) {
      drops++
      const done: Promise<void> = write.then(() => {}, () => {}).finally(() => { writing.delete(done) })
      writing.add(done)
      set(v)
      return write.then(() => {}, () => load())
    },
  }
}

// Calls `fn` with the latest value once calls stop for `ms`. `flush` calls it now with what is still waiting,
// so an editor that closes mid-typing still saves the last words; it hands back what `fn` returned.
export function debounce<T, R>(fn: (v: T) => R, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let waiting: { v: T } | undefined
  const flush = () => {
    clearTimeout(timer)
    const w = waiting
    waiting = undefined
    return w && fn(w.v)
  }
  return Object.assign((v: T) => { waiting = { v }; clearTimeout(timer); timer = setTimeout(flush, ms) }, { flush })
}

export async function api(url: string, method = 'GET', body?: unknown) {
  const res = await fetch(`/api/${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-tab': TAB } })
  const out = await res.json()
  if (!res.ok) throw new Error(out.error)
  return out
}

export function startCommand(task: Doc, project: Doc | undefined, root: string) {
  const repo = task.data.repo || list(project?.data.repos)[0] || root
  const account = project?.data.account || 'dm'
  const config = account === 'dm' ? '' : ` CLAUDE_CONFIG_DIR=$HOME/.claude-${account}`
  return `cd ${repo} && TASK_ID=${task.name}${config} claude`
}

export type Agent = {
  id: string; cwd: string; account: string; state: string; updated: string; title?: string
  message?: string; lastPrompt?: string; task?: string; inferred?: boolean; started?: string
}

// Project whose repo path is a prefix of the agent's working directory (worktrees included).
export function projectForPath(cwd: string, projects: Doc[]) {
  const home = cwd.match(/^\/Users\/[^/]+/)?.[0] ?? ''
  const norm = (p: string) => p.replace(/^~(?=\/|$)/, home).replace(/\/$/, '')
  let best: Doc | undefined
  let len = 0
  for (const p of projects) {
    for (const r of list(p.data.repos).map(norm)) {
      if (r && cwd.startsWith(r) && r.length > len) { best = p; len = r.length }
    }
  }
  return best
}

export function resumeCommand(a: Agent) {
  const config = a.account && a.account !== 'dm' ? ` CLAUDE_CONFIG_DIR=$HOME/.claude-${a.account}` : ''
  return `cd ${a.cwd} &&${config} claude --resume ${a.id}`
}

export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export const todayISO = () => new Date().toLocaleDateString('sv')

// Midnight to midnight of the day `d` falls on. Not 24 hours: the day the clocks change has 23 or 25.
export function dayRange(d: Date) {
  const from = new Date(d); from.setHours(0, 0, 0, 0)
  const to = new Date(from); to.setDate(to.getDate() + 1)
  return { from, to }
}

// Why a task deserves attention today, most urgent first; empty = not today's business.
export function urgency(t: Doc): { score: number; reasons: string[] } {
  if (t.data.status === 'done') return { score: 0, reasons: [] }
  const reasons: string[] = []
  let score = 0
  const due = String(t.data.due ?? '')
  const today = todayISO()
  if (due && due < today) { score += 60; reasons.push('overdue') } else if (due === today) { score += 50; reasons.push('due today') }
  else if (due && due <= new Date(Date.now() + 2 * 864e5).toLocaleDateString('sv')) { score += 25; reasons.push(`due ${due}`) }
  if (t.data.status === 'wip') { score += 30; reasons.push('in progress') }
  if (t.data.status === 'review') { score += 15; reasons.push('in review') }
  const p = PRIORITIES.indexOf(t.data.priority)
  if (p === 0) { score += 40; reasons.push('p0') } else if (p === 1) { score += 20; reasons.push('p1') }
  if (t.data.status === 'blocked') score -= 20
  return { score, reasons }
}

// Urgent and high priority: an ochre peak on the hill of a project that has open work like this.
export const URGENT = ['p0', 'p1']
// Work under way: it sits near the summit on the map and gets its name first.
export const OPEN_WORK = ['wip', 'blocked', 'review']

// A hill's contour rings from the peak outwards: blocked, in progress, review, to do. Shared out by how much
// open work has each status (at most 7 rings), with at least one ring for every status that has work.
// Unknown statuses count as to do.
const RING_ORDER = ['blocked', 'wip', 'review', 'todo']
export function hillRings(open: string[]) {
  const n = Math.min(7, open.length)
  const ring = (x: string) => (RING_ORDER.includes(x) ? x : 'todo')
  return RING_ORDER.flatMap((s) => {
    const count = open.filter((x) => ring(x) === s).length
    return Array<string>(count ? Math.max(1, Math.round((count / open.length) * n)) : 0).fill(s)
  }).slice(0, 7)
}

export const CONTEXT_LABEL: Record<string, string> = { dataminded: 'Data Minded', personal: 'Personal' }

// The context switch at the top scopes every page. '' is All; things without a known context only show there.
export const inContext = (context: string, c: unknown) => !context || c === context

export function scopeVault(vault: Vault, context: string): Vault {
  if (!context) return vault
  const projects = vault.projects.filter((p) => inContext(context, p.data.context))
  const names = new Set(projects.map((p) => p.name))
  const mine = (d: Doc) => names.has(unlink(d.data.project))
  return { ...vault, projects, tasks: vault.tasks.filter(mine), meetings: vault.meetings.filter(mine) }
}

const ACCOUNT_CONTEXT: Record<string, string> = { dm: 'dataminded', personal: 'personal' }

// A session or terminal belongs to its task's project, else the project whose repo it runs in.
export function projectOf(run: { cwd: string; task?: string }, vault: Vault) {
  const task = run.task ? vault.tasks.find((t) => t.name === run.task) : undefined
  return (task && vault.projects.find((p) => p.name === unlink(task.data.project))) || projectForPath(run.cwd, vault.projects)
}

// Without a project, it falls back to its account's context.
export function contextOf(run: { cwd: string; account: string; task?: string }, vault: Vault) {
  return projectOf(run, vault)?.data.context ?? ACCOUNT_CONTEXT[run.account]
}

// What a session works on, in one line: its task when it has one, else its first prompt.
export function agentLabel(a: Agent, tasks: Doc[]) {
  const task = a.task ? tasks.find((t) => t.name === a.task) : undefined
  return task ? `${task.name} ${task.data.title}` : a.title || a.cwd.split('/').pop() || a.id.slice(0, 8)
}

// A session you'd want to see now: working, or waiting for you.
export const isActive = (a: Agent) => a.state === 'working' || a.state === 'needs-input'

// The active session on each task. One that waits for you wins, so the card shows it needs you.
export function activeByTask(agents: Agent[]) {
  const byTask = new Map<string, Agent>()
  for (const a of agents) if (a.task && isActive(a) && byTask.get(a.task)?.state !== 'needs-input') byTask.set(a.task, a)
  return byTask
}

// Sessions per project, both in order of history: the most recently active first.
export function byProject(agents: Agent[], vault: Vault) {
  const groups = new Map<string, { project?: Doc; agents: Agent[] }>()
  for (const a of [...agents].sort((x, y) => y.updated.localeCompare(x.updated))) {
    const project = projectOf(a, vault)
    const key = project?.name ?? ''
    if (!groups.has(key)) groups.set(key, { project, agents: [] })
    groups.get(key)!.agents.push(a)
  }
  return [...groups.values()]
}

// The open terminal tab of each session: the tab that resumed it, else the tab started for its task.
// A task tab goes to that task's most recent session that started after it, so two sessions never share a tab.
export function tabsOf(agents: Agent[], terms: { id: string; agent?: string; task?: string; exited: boolean; started?: string }[]) {
  const tabs = new Map<string, string>()
  const open = terms.filter((t) => !t.exited)
  for (const a of [...agents].sort((x, y) => y.updated.localeCompare(x.updated))) {
    const tab = open.find((t) => t.agent === a.id)
      ?? open.find((t) => !t.agent && a.task && t.task === a.task && !(a.started && t.started && a.started < t.started)
        && ![...tabs.values()].includes(t.id))
    if (tab) tabs.set(a.id, tab.id)
  }
  return tabs
}

// Top 3: tasks you starred (`focus: true` in the file). Capped so it stays a real choice.
export const FOCUS_MAX = 3
// Starred in the file. It counts everywhere but in Done, where tasks sort by when they were finished.
export const starred = (d: Fields) => d.focus === true
export const isFocus = (t: Doc) => starred(t.data) && t.data.status !== 'done'
