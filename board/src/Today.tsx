import { useEffect, useState } from 'react'
import { Chat } from './Home'
import Split from './Split'
import { ago, api, prioLabel, projectForPath, resumeCommand, todayISO, unlink, urgency, type Agent, type Doc, type Vault } from './lib'

type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean }

// My day: agents waiting for you, today's meetings, a ranked plan, and the general assistant.
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// My day: who needs you, today's meetings, your top 3, and a small Now / Next / Waiting board.
export default function Today({ vault, tasks, agents, seen, openHere, open, write, fail, copy, prep, meetingNote }: {
  vault: Vault; tasks: Doc[]; agents: Agent[]; seen: (a: Agent) => void; openHere: (a: Agent) => void; open: (d: Doc) => void; write: (p: string) => void
  fail: (e: Error) => void; copy: (text: string, what: string) => void
  prep: (title: string, date: string) => void; meetingNote: (title: string, date: string, time?: string) => void
}) {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [calError, setCalError] = useState('')
  useEffect(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const to = new Date(from.getTime() + 864e5)
    api(`calendar?from=${from.toISOString()}&to=${to.toISOString()}`).then((r) => { setEvents(r.events); setCalError(r.error) }, fail)
  }, [])

  const ranked = tasks.map((t) => ({ t, ...urgency(t) })).filter((x) => x.t.data.status !== 'done').sort((a, b) => b.score - a.score)
  const top3 = ranked.filter((x) => x.score > 0 && x.t.data.status !== 'blocked').slice(0, 3)
  const shown = new Set(top3.map((x) => x.t.name))
  const column = (match: (t: Doc) => boolean, max = 8) => ranked.filter((x) => match(x.t) && !shown.has(x.t.name)).slice(0, max)
  const columns: [string, string, typeof ranked][] = [
    ['Now', 'in progress', column((t) => t.data.status === 'wip')],
    ['Next', 'highest todo first', column((t) => t.data.status === 'todo')],
    ['Waiting', 'review or blocked', column((t) => t.data.status === 'review' || t.data.status === 'blocked')],
  ]
  const waiting = agents.filter((a) => a.state === 'needs-input')
  const done = (t: Doc) => api(`tasks/${t.name}`, 'PUT', { data: { status: 'done' } }).catch(fail)
  const notesToday = vault.meetings.filter((m) => String(m.data.date) === todayISO())
  const noteFor = (title: string) => notesToday.find((m) => m.name.toLowerCase().endsWith(title.toLowerCase().replace(/[\\/:*?"<>|#^[\]]/g, '').trim()))
  const card = (x: (typeof ranked)[number], big = false) => (
    <MiniCard key={x.t.name} task={x.t} project={vault.projects.find((p) => p.name === unlink(x.t.data.project))} reasons={x.reasons}
      big={big} open={open} done={done} write={write} />
  )

  return (
    <Split id="today">
      <section className="pane today-main">
        <h2>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>

        {waiting.length > 0 && <>
          <h3>Agents waiting for you <span className="count">{waiting.length}</span></h3>
          <AgentList agents={waiting} vault={vault} copy={copy} seen={seen} openHere={openHere} />
        </>}

        <h3>Meetings today</h3>
        {calError && <p className="muted">{calError}</p>}
        <div className="meeting-strip">
          {events.map((e) => {
            const note = noteFor(e.title)
            return (
              <div key={e.id} className={`meeting-pill cal-${(e as any).calendar % 4}`}>
                <span className="time">{e.allDay ? 'all day' : time(e.start)}</span>
                <span className="meeting-title" title={e.title}>{e.title}</span>
                {note
                  ? <button className="icon" onClick={() => write(`meetings/${note.name}.md`)}>🗒 notes</button>
                  : <button className="icon" onClick={() => meetingNote(e.title, todayISO(), e.allDay ? '' : time(e.start))}>+ notes</button>}
                <button className="icon" onClick={() => prep(e.title, todayISO())}>+ prep</button>
              </div>
            )
          })}
          {notesToday.filter((m) => !events.some((e) => noteFor(e.title) === m)).map((m) => (
            <div key={m.name} className="meeting-pill">
              <span className="time">{m.data.time || 'note'}</span>
              <span className="meeting-title">{m.name.replace(/^\d{4}-\d{2}-\d{2} /, '')}</span>
              <button className="icon" onClick={() => write(`meetings/${m.name}.md`)}>🗒 notes</button>
            </div>
          ))}
          {!events.length && !notesToday.length && !calError && <span className="muted">No meetings today.</span>}
        </div>

        <h3>Top 3 today</h3>
        <div className="top3">
          {top3.map((x) => card(x, true))}
          {!top3.length && <span className="muted">Nothing urgent. Pick something from Next.</span>}
        </div>

        <div className="mini-board">
          {columns.map(([name, hint, items]) => (
            <section key={name} className="mini-col">
              <h3>{name} <span className="count">{items.length}</span> <span className="muted hint-inline">{hint}</span></h3>
              {items.map((x) => card(x))}
              {!items.length && <span className="muted">Empty</span>}
            </section>
          ))}
        </div>
      </section>
      <Chat clearTask={() => {}} />
    </Split>
  )
}

function MiniCard({ task, project, reasons, big, open, done, write }: {
  task: Doc; project?: Doc; reasons: string[]; big?: boolean; open: (d: Doc) => void; done: (d: Doc) => void; write: (p: string) => void
}) {
  const d = task.data
  const extra = reasons.filter((r) => !/^p\d$|^in progress$|^in review$/.test(r))
  return (
    <article className={`mini-card ${big ? 'big' : ''}`} onClick={() => open(task)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(task)}>
      <div className="mini-top">
        <span className={`dot ${project?.data.context ?? ''}`} />
        <span className="mini-project">{project?.data.name ?? (unlink(d.project) || 'No project')}</span>
        <span className={`prio ${d.priority}`}>{prioLabel(d.priority)}</span>
      </div>
      <div className="mini-title">{d.title ?? task.name}</div>
      <div className="mini-bottom">
        {d.blocked_by && <span className="reason">⛔ {String(d.blocked_by).replace(/\[|\]/g, '')}</span>}
        {extra.map((r) => <span key={r} className="reason">{r}</span>)}
        {d.notion && <a href={d.notion} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Notion ↗</a>}
        {d.pr && <a href={d.pr} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>PR ↗</a>}
        <span className="spacer" />
        <button className="icon" title="Write notes for this task" onClick={(e) => { e.stopPropagation(); write(`tasks/${task.name}.md`) }}>¶</button>
        <button className="icon" title="Mark done" onClick={(e) => { e.stopPropagation(); done(task) }}>✓</button>
      </div>
    </article>
  )
}

export function AgentList({ agents, vault, copy, seen, openHere }: {
  agents: Agent[]; vault: Vault; copy: (text: string, what: string) => void; seen?: (a: Agent) => void; openHere?: (a: Agent) => void
}) {
  return (
    <ul className="agent-list">
      {agents.map((a) => {
        const p = projectForPath(a.cwd, vault.projects)
        return (
          <li key={a.id} className={`agent ${a.state}`}>
            <div className="agent-top">
              <span className={`state ${a.state}`}>{STATE_LABEL[a.state] ?? a.state}</span>
              <strong>{p?.data.name ?? a.cwd.split('/').pop()}</strong>
              {a.task && <span className="chip">{a.task}</span>}
              <span className="muted">{a.account} · {ago(a.updated)}</span>
              <div className="spacer" />
              {seen && a.state === 'needs-input' && <button className="icon" title="Hide until this session changes" onClick={() => seen(a)}>✓ seen</button>}
              {openHere && a.state !== 'working' && <button className="icon" title="Resume this session in a workbench terminal (close it elsewhere first)" onClick={() => openHere(a)}>open here ›_</button>}
              <button className="icon" title="Copy a command that resumes this session in a terminal" onClick={() => copy(resumeCommand(a), 'Resume command')}>resume ⧉</button>
            </div>
            {a.title && <div className="agent-title">{a.title}</div>}
            {a.message && <div className="agent-msg">{a.message}</div>}
          </li>
        )
      })}
    </ul>
  )
}

const STATE_LABEL: Record<string, string> = { 'needs-input': 'needs you', working: 'working', idle: 'idle', ended: 'ended', unknown: '?' }
const ORDER = ['needs-input', 'working', 'idle', 'unknown', 'ended']

export function Agents({ agents, vault, copy, seen, openHere }: {
  agents: Agent[]; vault: Vault; copy: (text: string, what: string) => void; seen: (a: Agent) => void; openHere: (a: Agent) => void
}) {
  return (
    <main className="agents-page">
      <h2>Agents</h2>
      <p className="muted">Every Claude Code session in both accounts (terminal, desktop app, IDE), from the last 3 days. Hooks report state live; sessions started before the hooks were installed are inferred from their transcript.</p>
      {ORDER.map((s) => {
        const group = agents.filter((a) => (ORDER.includes(a.state) ? a.state : 'unknown') === s)
        return group.length ? (
          <section key={s}>
            <h3>{STATE_LABEL[s]} <span className="count">{group.length}</span></h3>
            <AgentList agents={group} vault={vault} copy={copy} seen={seen} openHere={openHere} />
          </section>
        ) : null
      })}
      {!agents.length && <p className="muted">No recent sessions.</p>}
    </main>
  )
}
