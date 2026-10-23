import { EyeOff, ListPlus, NotebookText, TerminalSquare } from 'lucide-react'
import { IconButton } from './ui'
import Landscape from './Landscape'
import { useEffect, useState } from 'react'
import { ProjectSelect } from './Home'
import { agentLabel, ago, api, byProject, isActive, todayISO, unlink, urgency, type Agent, type Doc, type Vault } from './lib'

type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean; calendar?: number }
export type Actions = {
  open: (d: Doc) => void
  project: (id: string) => void
  start: (d: Doc) => void
  autopilot: (d: Doc) => void
  focus: (d: Doc) => void
  done: (d: Doc) => void
  deps: (d: Doc) => void
  agent: (a: Agent) => void
  write: (p: string) => void
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// My day: today's meetings, what's due, the agents at work or waiting for you, and your board (the real
// one, so you can drag). Every row and card opens what it shows; secondary actions appear on hover.
export default function Today({ vault, tasks, agents, tabs, seen, act, fail, prep, meetingNote, board }: {
  vault: Vault; tasks: Doc[]; agents: Agent[]; tabs: Map<string, string>; seen: (a: Agent) => void; act: Actions
  fail: (e: Error) => void; prep: (title: string, date: string) => void; meetingNote: (title: string, date: string, time?: string) => void
  board: React.ReactNode
}) {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [calError, setCalError] = useState('')
  useEffect(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const to = new Date(from.getTime() + 864e5)
    api(`calendar?from=${from.toISOString()}&to=${to.toISOString()}`).then((r) => { setEvents(r.events); setCalError(r.error) }, fail)
  }, [])

  // Overdue and due in the next two days, most urgent first.
  const due = tasks.map((t) => ({ t, ...urgency(t) })).filter((x) => x.reasons.some((r) => /overdue|due/.test(r))).sort((x, y) => y.score - x.score)
  const active = agents.filter(isActive)
  const notesToday = vault.meetings.filter((m) => String(m.data.date) === todayISO())
  const noteFor = (title: string) => notesToday.find((m) => m.name.toLowerCase().endsWith(title.toLowerCase().replace(/[\\/:*?"<>|#^[\]]/g, '').trim()))
  return (
    <main className="today">
      <p className="today-date">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>

      <Landscape projects={vault.projects} tasks={tasks} open={act.project} />

      <section>
        <h3>Meetings today</h3>
        {calError && <p className="muted">{calError}</p>}
        <div className="meeting-strip">
          {events.map((e) => {
            const note = noteFor(e.title)
            const openNote = () => (note ? act.write(`meetings/${note.name}.md`) : meetingNote(e.title, todayISO(), e.allDay ? '' : time(e.start)))
            return (
              <div key={e.id} className={`meeting-pill clickable cal-${(e.calendar ?? 0) % 4}`} role="button" tabIndex={0} title={note ? 'Open meeting notes' : 'Start meeting notes'}
                onClick={openNote} onKeyDown={(k) => k.key === 'Enter' && openNote()}>
                <span className="time">{e.allDay ? 'all day' : time(e.start)}</span>
                <span className="meeting-title">{e.title}</span>
                {note && <NotebookText size={14} className="note-mark" aria-label="Has notes" />}
                <span className="hover-actions">
                  <IconButton icon={ListPlus} label="Add a prep todo" stop onClick={() => prep(e.title, todayISO())} />
                </span>
              </div>
            )
          })}
          {notesToday.filter((m) => !events.some((e) => noteFor(e.title) === m)).map((m) => (
            <div key={m.name} className="meeting-pill clickable" role="button" tabIndex={0} onClick={() => act.write(`meetings/${m.name}.md`)}>
              <span className="time">{m.data.time || 'note'}</span>
              <span className="meeting-title">{m.name.replace(/^\d{4}-\d{2}-\d{2} /, '')}</span>
              <NotebookText size={14} className="note-mark" aria-hidden />
            </div>
          ))}
          {!events.length && !notesToday.length && !calError && <span className="muted">No meetings today.</span>}
        </div>
      </section>

      {due.length > 0 && (
        <section>
          <h3>Due soon <span className="count">{due.length}</span></h3>
          <div className="due-strip">
            {due.map(({ t, reasons }) => (
              <button key={t.name} className={`due-pill ${reasons.includes('overdue') ? 'overdue' : ''}`} onClick={() => act.open(t)}>
                <span className="due-when">{reasons.find((r) => /overdue|due/.test(r))}</span> {t.data.title}
              </button>
            ))}
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section>
          <h3>Agents <span className="count">{active.length}</span></h3>
          <AgentList agents={active} vault={vault} tabs={tabs} open={act.agent} seen={seen} />
        </section>
      )}

      <section>
        <h3>Your board <span className="muted hint-inline">drag cards to change status</span></h3>
        {board}
      </section>
    </main>
  )
}

export const STATE_LABEL: Record<string, string> = { 'needs-input': 'needs you', working: 'working', idle: 'idle', ended: 'ended', unknown: '?' }

// One line per Claude session: its state, what it works on, and how long ago. The row opens its tab,
// or resumes the session in a new one; the row of the tab you're looking at is marked.
export function AgentList({ agents, vault, tabs, active, open, seen }: {
  agents: Agent[]; vault: Vault; tabs: Map<string, string>; active?: string; open: (a: Agent) => void; seen?: (a: Agent) => void
}) {
  return (
    <ul className="agent-list">
      {agents.map((a) => {
        const label = agentLabel(a, vault.tasks)
        const tab = tabs.get(a.id)
        return (
          <li key={a.id} className={`agent clickable ${a.state} ${tab && tab === active ? 'on' : ''}`} role="button" tabIndex={0}
            title={`${label}\n${tab ? 'Show its tab' : 'Open this session here'}`} onClick={() => open(a)} onKeyDown={(e) => e.key === 'Enter' && open(a)}>
            <span className={`state ${a.state}`}>{STATE_LABEL[a.state] ?? a.state}</span>
            <span className="agent-title">{label}</span>
            {tab && <TerminalSquare size={14} className="muted" aria-label="Has an open tab" />}
            <span className="muted agent-ago">{ago(a.updated)}</span>
            {seen && a.state === 'needs-input' && (
              <span className="hover-actions"><IconButton icon={EyeOff} label="Seen: hide until this session changes" stop onClick={() => seen(a)} /></span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// New agent: pick a project, optionally a task and a first instruction; it starts in a terminal tab.
function NewAgent({ vault, start }: { vault: Vault; start: (body: Record<string, string>) => void }) {
  const active = vault.projects.filter((p) => p.data.status !== 'done')
  const [picked, setProject] = useState('')
  const [pickedTask, setTask] = useState('')
  const [prompt, setPrompt] = useState('')
  // Falls back to the first project in context when the switch at the top hides the one picked.
  const project = active.some((p) => p.name === picked) ? picked : active[0]?.name ?? ''
  const tasks = vault.tasks.filter((t) => unlink(t.data.project) === project && t.data.status !== 'done')
  const task = tasks.some((t) => t.name === pickedTask) ? pickedTask : ''
  const account = vault.projects.find((p) => p.name === project)?.data.account
  return (
    <form className="new-agent" onSubmit={(e) => { e.preventDefault(); start({ kind: 'claude', project, task, prompt }); setPrompt('') }}>
      <h3>New agent</h3>
      <div className="row">
        <ProjectSelect projects={active} all={active} value={project} onChange={(name) => { setProject(name); setTask('') }} />
        <select value={task} onChange={(e) => setTask(e.target.value)} aria-label="Task (optional)">
          <option value="">No specific task</option>
          {tasks.map((t) => <option key={t.name} value={t.name}>{t.name} {t.data.title}</option>)}
        </select>
      </div>
      <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="First instruction (optional), e.g. “Grill me on this task”" />
      <div className="row-actions">
        <span className="muted">{account ? `${account} account` : ''}</span>
        <button type="submit" className="primary">▶ Start agent</button>
      </div>
    </form>
  )
}

export function Agents({ agents, vault, tabs, active, open, seen, act, start }: {
  agents: Agent[]; vault: Vault; tabs: Map<string, string>; active?: string
  open: (a: Agent) => void; seen: (a: Agent) => void; act: Actions; start: (body: Record<string, string>) => void
}) {
  return (
    <section className="pane agents-page">
      <NewAgent vault={vault} start={start} />
      {byProject(agents, vault).map(({ project, agents: group }) => (
        <section key={project?.name ?? ''}>
          <h3>
            {project ? <button className="link-plain" onClick={() => act.project(project.name)}>{project.data.name ?? project.name}</button> : 'No project'}
            <span className="count">{group.length}</span>
          </h3>
          <AgentList agents={group} vault={vault} tabs={tabs} active={active} open={open} seen={seen} />
        </section>
      ))}
      {!agents.length && <p className="muted">No recent sessions.</p>}
    </section>
  )
}
