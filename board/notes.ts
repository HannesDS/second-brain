// Notes: free writing saved as-is, then an agent proposes where it belongs and you approve.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { context as ragContext } from '../lib/rag.mjs'
import { ID, ROOT, VAULT, listDocs, nextTaskId, readDoc, today, updateDoc, writeDoc } from '../lib/vault.mjs'
import { WORKBENCH_ACCOUNT, claudeEnv } from './claude'
import { meetingContext, setSection } from './meetings'

const run = promisify(execFile)
const EDITABLE = ['inbox', 'notes', 'meetings', 'tasks', 'projects']

// Resolves a vault-relative path, refusing anything outside the editable folders.
export function vaultPath(rel: string) {
  const full = path.resolve(VAULT, rel)
  const dir = path.relative(VAULT, full).split(path.sep)[0]
  if (!full.endsWith('.md') || !EDITABLE.includes(dir)) throw new Error(`not an editable note: ${rel}`)
  return full
}

export function listNotes() {
  return ['inbox', 'notes', 'meetings'].flatMap((dir) => listDocs(dir).map((d) => ({
    path: `${dir}/${d.name}.md`, name: d.name, data: d.data,
    mtime: fs.statSync(path.join(VAULT, dir, `${d.name}.md`)).mtime.toISOString(),
  }))).sort((a, b) => noteDate(b).localeCompare(noteDate(a)) || b.mtime.localeCompare(a.mtime))
}

// When a note is about: the date it starts with, else when it was last saved.
const noteDate = (n: { name: string; mtime: string }) => /^\d{4}-\d{2}-\d{2}/.exec(n.name)?.[0] ?? n.mtime.slice(0, 10)

export function createNote(title: string) {
  const stamp = new Date().toLocaleString('sv').slice(0, 16).replace(':', '')
  const name = `${stamp} ${title.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Note'}`
  const rel = `inbox/${name}.md`
  writeDoc(vaultPath(rel), { created: today(), status: 'inbox', project: '', tasks: [] }, '')
  return rel
}

// Saves the body and/or merges frontmatter fields; fields added in Obsidian stay as they are.
export function saveDoc(rel: string, body?: string, data: Record<string, unknown> = {}) {
  const file = vaultPath(rel)
  if (!fs.existsSync(file)) throw new Error(`${rel} does not exist`)
  const text = fs.readFileSync(file, 'utf8')
  if (!text.startsWith('---') && body !== undefined && !Object.keys(data).length) return fs.writeFileSync(file, body)
  updateDoc(file, data, body)
}

const SCHEMA = {
  type: 'object',
  required: ['summary', 'actions'],
  properties: {
    summary: { type: 'string', description: 'One sentence: what this note is about.' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'reason'],
        properties: {
          kind: { enum: ['set-project', 'new-project', 'create-task', 'append-to-task', 'link-meeting', 'external', 'summary', 'action-points', 'attendees'] },
          reason: { type: 'string' },
          project: { type: 'string', description: 'project id (existing, or the new id for new-project)' },
          projectName: { type: 'string' },
          context: { enum: ['dataminded', 'personal'] },
          account: { enum: ['dm', 'personal'] },
          task: { type: 'string', description: 'existing task id for append-to-task' },
          title: { type: 'string' },
          priority: { enum: ['p0', 'p1', 'p2', 'p3'] },
          type: { enum: ['code', 'pr-review', 'meeting', 'research', 'admin'] },
          text: { type: 'string', description: 'task description, or the text to append' },
          meeting: { type: 'string', description: 'meeting note name without .md' },
          url: { type: 'string', description: 'for external: what to update outside the vault (Notion page, ADR, PR)' },
          people: { type: 'array', items: { type: 'string' }, description: 'for attendees: first names heard in the meeting' },
        },
      },
    },
  },
}

export async function proposeFiling(rel: string) {
  const note = readDoc(vaultPath(rel))
  const projects = listDocs('projects').map((p) => `${p.name}: ${p.data.name} (${p.data.context}, ${p.data.account})`).join('\n')
  const tasks = listDocs('tasks').filter((t) => t.data.status !== 'done')
    .map((t) => `${t.name} [${String(t.data.project ?? '').replace(/\W/g, '')}] ${t.data.title}${t.data.notion ? ` (notion: ${t.data.notion})` : ''}`).join('\n')
  const meetings = listDocs('meetings').map((m) => m.name).sort().slice(-30).join('\n')
  const related = await ragContext(note.body.slice(0, 2000), 8)
  const meeting = rel.startsWith('meetings/') ? meetingContext(rel) : undefined
  const prompt = `You file a note in the user's second-brain vault. Propose actions; the user approves each one.${meeting ? `
This is a MEETING note (date ${meeting.data.date}). Always propose: one "summary" action (text: 3-6 bullet markdown summary),
one "action-points" action (text: markdown checklist "- [ ] what (who)", one line per action, owner in brackets), and "attendees" if names are clear.
Then create-task only for action points owned by the user (Hannes), and append-to-task where an action belongs to an existing task.` : ''}
Rules: prefer existing projects and tasks; propose new-project only when nothing fits. Propose create-task only for concrete, open work in the note.
Use append-to-task to add findings to an existing task. Use external for things that must be updated outside the vault (the team's Notion ticket, an ADR, a PR) and say what to change.
Keep it short: usually 1-4 actions. Do not use tools.

PROJECTS:
${projects}

OPEN TASKS:
${tasks}

RECENT MEETINGS:
${meetings}

RELATED NOTES (by similarity):
${related || '(none)'}

NOTE (${rel}):
${note.body}${meeting?.transcript ? `

TRANSCRIPT (automatic, may contain errors; Dutch and English mixed):
${meeting.transcript.slice(-60_000)}` : ''}`
  const { stdout } = await run('claude', ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--model', 'sonnet', prompt], {
    cwd: ROOT, env: claudeEnv(WORKBENCH_ACCOUNT), timeout: 180_000, maxBuffer: 10 * 1024 * 1024,
  })
  const out = JSON.parse(stdout)
  return out.structured_output ?? JSON.parse(out.result)
}

type Action = Record<string, any>

export function applyFiling(rel: string, actions: Action[]) {
  const file = vaultPath(rel)
  const noteName = path.basename(rel, '.md')
  const note = readDoc(file)
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  const isMeeting = rel.startsWith('meetings/')
  const patch: Record<string, unknown> = { ...(isMeeting ? {} : { status: 'filed', meetings: list(note.data.meetings) }), tasks: list(note.data.tasks) }
  let body = note.body
  const done: string[] = []

  for (const a of actions) {
    if (a.kind === 'new-project' && ID.test(a.project ?? '')) {
      const f = path.join(VAULT, 'projects', `${a.project}.md`)
      if (!fs.existsSync(f)) writeDoc(f, { id: a.project, name: a.projectName || a.project, context: a.context || 'personal', account: a.account || 'personal', repos: [], status: 'active' }, `${a.reason}\n`)
      patch.project = `[[${a.project}]]`
      done.push(`project ${a.project} created`)
    } else if (a.kind === 'set-project' && ID.test(a.project ?? '')) {
      patch.project = `[[${a.project}]]`
      done.push(`filed under ${a.project}`)
    } else if (a.kind === 'create-task' && a.title) {
      const id = nextTaskId()
      const project = a.project || String(patch.project ?? note.data.project ?? '').replace(/\[|\]/g, '')
      writeDoc(path.join(VAULT, 'tasks', `${id}.md`), {
        id, title: a.title, aliases: [a.title], project: project ? `[[${project}]]` : '', status: 'todo',
        priority: a.priority || 'p2', order: 0, type: a.type || 'code', blocked_by: '', repo: '', branch: '', pr: '',
        sessions: [], meetings: [], sources: [`[[${noteName}]]`], due: '', created: today(), updated: today(),
      }, `${a.text ?? ''}\n\nFrom note [[${noteName}]].\n`)
      ;(patch.tasks as string[]).push(`[[${id}]]`)
      done.push(`${id} created`)
    } else if (a.kind === 'append-to-task' && ID.test(a.task ?? '')) {
      const f = path.join(VAULT, 'tasks', `${a.task}.md`)
      if (!fs.existsSync(f)) continue
      updateDoc(f, {}, `${readDoc(f).body.trimEnd()}\n\n## Note ${today()}\n\n${a.text ?? ''}\n\nSee [[${noteName}]].\n`)
      ;(patch.tasks as string[]).push(`[[${a.task}]]`)
      done.push(`added to ${a.task}`)
    } else if (a.kind === 'summary' && a.text) {
      body = setSection(body, 'Summary', a.text)
      done.push('summary written')
    } else if (a.kind === 'action-points' && a.text) {
      body = setSection(body, 'Action Points', a.text)
      done.push('action points written')
    } else if (a.kind === 'attendees' && Array.isArray(a.people)) {
      patch.attendees = [...new Set([...list(note.data.attendees), ...a.people])]
      done.push('attendees set')
    } else if (a.kind === 'link-meeting' && a.meeting) {
      ;(patch.meetings as string[]).push(`[[${a.meeting}]]`)
      done.push(`linked to ${a.meeting}`)
    }
  }
  patch.tasks = [...new Set(patch.tasks as string[])]
  if (patch.meetings) patch.meetings = [...new Set(patch.meetings as string[])]
  updateDoc(file, patch, body)
  return done
}
