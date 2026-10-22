import { useEffect, useState } from 'react'
import { ago, api, isFocus, prioLabel, projectForPath, todayISO, unlink, urgency, type Agent, type Doc, type Vault } from './lib'

type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean; calendar?: number }
export type Actions = {
  open: (d: Doc) => void
  project: (id: string) => void
  start: (d: Doc) => void
  focus: (d: Doc) => void
  done: (d: Doc) => void
  write: (p: string) => void
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// My day: who needs you, today's meetings, your top 3, and a small Now / Next / Waiting board.
// Every row and card opens what it shows; secondary actions appear on hover.
export default function Today({ vault, tasks, agents, act, openAgent, seen, fail, prep, meetingNote }: {
  vault: Vault; tasks: Doc[]; agents: Agent[]; act: Actions; openAgent: (a: Agent) => void; seen: (a: Agent) => void
  fail: (e: Error) => void; prep: (title: string, date: string) => void; meetingNote: (title: string, date: string, time?: string) => void
}) {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [calError, setCalError] = useState('')
  useEffect(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const to = new Date(from.getTime() + 864e5)
    api(`calendar?from=${from.toISOString()}&to=${to.toISOString()}`).then((r) => { setEvents(r.events); setCalError(r.error) }, fail)
  }, [])

  const ranked = tasks.map((t) => ({ t, ...urgency(t) })).filter((x) => x.t.data.status !== 'done').sort((a, b) => b.score - a.score)
  const starred = ranked.filter((x) => isFocus(x.t))
  // Until you star three, the most urgent tasks are suggested to fill the gap.
  const suggested = ranked.filter((x) => !isFocus(x.t) && x.score > 0 && x.t.data.status !== 'blocked').slice(0, Math.max(0, 3 - starred.length))
  const column = (match: (t: Doc) => boolean, max = 6) => ranked.filter((x) => match(x.t)).slice(0, max)
  const columns: [string, typeof ranked, number][] = [
    ['Now', column((t) => t.data.status === 'wip'), ranked.filter((x) => x.t.data.status === 'wip').length],
    ['Next', column((t) => t.data.status === 'todo'), ranked.filter((x) => x.t.data.status === 'todo').length],
    ['Waiting', column((t) => t.data.status === 'review' || t.data.status === 'blocked'), ranked.filter((x) => ['review', 'blocked'].includes(x.t.data.status)).length],
  ]
  const waiting = agents.filter((a) => a.state === 'needs-input')
  const notesToday = vault.meetings.filter((m) => String(m.data.date) === todayISO())
  const noteFor = (title: string) => notesToday.find((m) => m.name.toLowerCase().endsWith(title.toLowerCase().replace(/[\\/:*?"<>|#^[\]]/g, '').trim()))
  const card = (x: (typeof ranked)[number], extra = '') => (
    <TaskCard key={x.t.name + extra} task={x.t} project={vault.projects.find((p) => p.name === unlink(x.t.data.project))} reasons={x.reasons} act={act} suggested={extra === 'suggested'} />
  )

  return (
    <main className="today">
      <h1>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>

      {waiting.length > 0 && (
        <section>
          <h3>Agents waiting for you <span className="count">{waiting.length}</span></h3>
          <AgentList agents={waiting} vault={vault} open={openAgent} seen={seen} act={act} />
        </section>
      )}

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
                {note && <span className="note-mark" title="Has notes">🗒</span>}
                <span className="hover-actions">
                  <button className="icon" title="Add a prep todo for this meeting" onClick={(k) => { k.stopPropagation(); prep(e.title, todayISO()) }}>+ prep</button>
                </span>
              </div>
            )
          })}
          {notesToday.filter((m) => !events.some((e) => noteFor(e.title) === m)).map((m) => (
            <div key={m.name} className="meeting-pill clickable" role="button" tabIndex={0} onClick={() => act.write(`meetings/${m.name}.md`)}>
              <span className="time">{m.data.time || 'note'}</span>
              <span className="meeting-title">{m.name.replace(/^\d{4}-\d{2}-\d{2} /, '')}</span>
              <span className="note-mark">🗒</span>
            </div>
          ))}
          {!events.length && !notesToday.length && !calError && <span className="muted">No meetings today.</span>}
        </div>
      </section>

      <section>
        <h3>Top 3 <span className="muted hint-inline">{starred.length ? 'starred by you' : 'suggested: star ☆ the ones you pick'}</span></h3>
        <div className="top3">
          {starred.map((x) => card(x))}
          {suggested.map((x) => card(x, 'suggested'))}
          {!starred.length && !suggested.length && <span className="muted">Nothing urgent. Star a task from Next.</span>}
        </div>
      </section>

      <div className="mini-board">
        {columns.map(([name, items, total]) => (
          <section key={name} className="mini-col">
            <h3>{name} <span className="count">{total}</span></h3>
            {items.map((x) => card(x))}
            {total > items.length && <a className="more" href="#board">+{total - items.length} more on the Board</a>}
            {!items.length && <span className="muted">Empty</span>}
          </section>
        ))}
      </div>
    </main>
  )
}

export function TaskCard({ task, project, reasons = [], act, suggested }: {
  task: Doc; project?: Doc; reasons?: string[]; act: Actions; suggested?: boolean
}) {
  const d = task.data
  const extra = reasons.filter((r) => !/^p\d$|^in progress$|^in review$/.test(r))
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }
  return (
    <article className={`mini-card clickable ${isFocus(task) ? 'focus' : ''} ${suggested ? 'suggested' : ''}`} onClick={() => act.open(task)} tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && act.open(task)}>
      <div className="mini-top">
        <button className="link-plain" title="Open project" onClick={stop(() => act.project(unlink(d.project)))}>
          <span className={`dot ${project?.data.context ?? ''}`} />{project?.data.name ?? (unlink(d.project) || 'No project')}
        </button>
        <span className="spacer" />
        <span className={`prio ${d.priority}`}>{prioLabel(d.priority)}</span>
        <button className={`star ${isFocus(task) ? 'on' : ''}`} title={isFocus(task) ? 'Remove from top 3' : 'Add to top 3'} aria-pressed={isFocus(task)}
          onClick={stop(() => act.focus(task))}>{isFocus(task) ? '★' : '☆'}</button>
      </div>
      <div className="mini-title">{d.title ?? task.name}</div>
      <div className="mini-bottom">
        {d.blocked_by && <span className="reason">⛔ {String(d.blocked_by).replace(/\[|\]/g, '')}</span>}
        {extra.map((r) => <span key={r} className="reason">{r}</span>)}
        {d.notion && <a href={d.notion} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Notion ↗</a>}
        {d.pr && <a href={d.pr} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>PR ↗</a>}
        <span className="spacer" />
        <span className="hover-actions">
          <button className="icon" title="Start an agent on this task" onClick={stop(() => act.start(task))}>▶</button>
          <button className="icon" title="Write in this task" onClick={stop(() => act.write(`tasks/${task.name}.md`))}>¶</button>
          <button className="icon" title="Mark done" onClick={stop(() => act.done(task))}>✓</button>
        </span>
      </div>
    </article>
  )
}

const STATE_LABEL: Record<string, string> = { 'needs-input': 'needs you', working: 'working', idle: 'idle', ended: 'ended', unknown: '?' }
const ORDER = ['needs-input', 'working', 'idle', 'unknown', 'ended']

// One row per Claude session. Click the row to open it in a workbench terminal.
export function AgentList({ agents, vault, open, seen, act }: {
  agents: Agent[]; vault: Vault; open: (a: Agent) => void; seen?: (a: Agent) => void; act: Actions
}) {
  return (
    <ul className="agent-list">
      {agents.map((a) => {
        const p = projectForPath(a.cwd, vault.projects)
        const task = a.task ? vault.tasks.find((t) => t.name === a.task) : undefined
        const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }
        return (
          <li key={a.id} className={`agent clickable ${a.state}`} role="button" tabIndex={0} title="Open this session here"
            onClick={() => open(a)} onKeyDown={(e) => e.key === 'Enter' && open(a)}>
            <div className="agent-top">
              <span className={`state ${a.state}`}>{STATE_LABEL[a.state] ?? a.state}</span>
              {p
                ? <button className="link-plain strong" onClick={stop(() => act.project(p.name))}>{p.data.name ?? p.name}</button>
                : <strong>{a.cwd.split('/').pop()}</strong>}
              {task && <button className="chip" onClick={stop(() => act.open(task))}>{task.name} {task.data.title}</button>}
              <span className="muted">{a.account} · {ago(a.updated)}</span>
              <span className="spacer" />
              {seen && a.state === 'needs-input' && (
                <span className="hover-actions"><button className="icon" title="Hide until this session changes" onClick={stop(() => seen(a))}>✓ seen</button></span>
              )}
            </div>
            {a.title && <div className="agent-title">{a.title}</div>}
            {a.message && <div className="agent-msg">{a.message}</div>}
          </li>
        )
      })}
    </ul>
  )
}

// New agent: pick a project, optionally a task and a first instruction; it starts in a terminal tab.
function NewAgent({ vault, start }: { vault: Vault; start: (body: Record<string, string>) => void }) {
  const active = vault.projects.filter((p) => p.data.status !== 'done')
  const [project, setProject] = useState(active[0]?.name ?? '')
  const [task, setTask] = useState('')
  const [prompt, setPrompt] = useState('')
  const tasks = vault.tasks.filter((t) => unlink(t.data.project) === project && t.data.status !== 'done')
  const account = vault.projects.find((p) => p.name === project)?.data.account
  return (
    <form className="new-agent" onSubmit={(e) => { e.preventDefault(); start({ kind: 'claude', project, task, prompt }); setPrompt('') }}>
      <h3>New agent</h3>
      <div className="row">
        <select value={project} onChange={(e) => { setProject(e.target.value); setTask('') }} aria-label="Project">
          {active.map((p) => <option key={p.name} value={p.name}>{p.data.name ?? p.name}</option>)}
        </select>
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

export function Agents({ agents, vault, open, seen, act, start }: {
  agents: Agent[]; vault: Vault; open: (a: Agent) => void; seen: (a: Agent) => void; act: Actions; start: (body: Record<string, string>) => void
}) {
  return (
    <section className="pane agents-page">
      <NewAgent vault={vault} start={start} />
      {ORDER.map((s) => {
        const group = agents.filter((a) => (ORDER.includes(a.state) ? a.state : 'unknown') === s)
        return group.length ? (
          <section key={s}>
            <h3>{STATE_LABEL[s]} <span className="count">{group.length}</span></h3>
            <AgentList agents={group} vault={vault} open={open} seen={seen} act={act} />
          </section>
        ) : null
      })}
      {!agents.length && <p className="muted">No recent sessions.</p>}
    </section>
  )
}
