export type Fields = Record<string, any>
export type Doc = { name: string; data: Fields; body: string; error?: string }
export type Vault = { root: string; vault: string; projects: Doc[]; tasks: Doc[]; meetings: Doc[] }

export const STATUSES = ['todo', 'wip', 'review', 'blocked', 'done']
export const LABELS: Record<string, string> = { todo: 'Todo', wip: 'WIP', review: 'Review', blocked: 'Blocked', done: 'Done', '?': '?' }
export const PRIORITIES = ['p0', 'p1', 'p2', 'p3']
// Files keep p0-p3 (short, sortable); people see words.
export const PRIO_LABEL: Record<string, string> = { p0: 'Urgent', p1: 'High', p2: 'Normal', p3: 'Low' }
export const prioLabel = (p: unknown) => PRIO_LABEL[String(p)] ?? 'Normal'
export const TYPES = ['code', 'pr-review', 'meeting', 'research', 'admin']
export const CONTEXTS = ['dataminded', 'personal']
export const LIST_FIELDS = ['sessions', 'meetings', 'sources']

// "[[portal|Portal]]" -> "portal"
export const unlink = (v: unknown) => String(v ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0]
export const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : [])
export const columnOf = (t: Doc) => (STATUSES.includes(t.data.status) ? t.data.status : '?')
export const obsidian = (p: string) => `obsidian://open?path=${encodeURIComponent(p)}`
export const byOrder = (a: Doc, b: Doc) => (Number(a.data.order) || 0) - (Number(b.data.order) || 0) || a.name.localeCompare(b.name)

export async function api(url: string, method = 'GET', body?: unknown) {
  const res = await fetch(`/api/${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } })
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
  message?: string; lastPrompt?: string; task?: string; inferred?: boolean
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

// A session or terminal belongs to its task's project, else the project whose repo it runs in, else its account's context.
export function contextOf(run: { cwd: string; account: string; task?: string }, vault: Vault) {
  const task = run.task ? vault.tasks.find((t) => t.name === run.task) : undefined
  const project = (task && vault.projects.find((p) => p.name === unlink(task.data.project))) || projectForPath(run.cwd, vault.projects)
  return project?.data.context ?? ACCOUNT_CONTEXT[run.account]
}

// Top 3: tasks you starred (`focus: true` in the file). Capped so it stays a real choice.
export const FOCUS_MAX = 3
export const isFocus = (t: Doc) => t.data.focus === true && t.data.status !== 'done'
