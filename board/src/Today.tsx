import { useEffect, useState } from 'react'
import { Chat, TodoList } from './Home'
import { ago, api, projectForPath, resumeCommand, todayISO, urgency, type Agent, type Doc, type Vault } from './lib'

type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean }

// My day: agents waiting for you, today's meetings, a ranked plan, and the general assistant.
export default function Today({ vault, tasks, agents, seen, openHere, open, write, fail, copy, prep, meetingNote }: {
  vault: Vault; tasks: Doc[]; agents: Agent[]; seen: (a: Agent) => void; openHere: (a: Agent) => void; open: (d: Doc) => void; write: (p: string) => void
  fail: (e: Error) => void; copy: (text: string, what: string) => void
  prep: (title: string, date: string) => void; meetingNote: (title: string, date: string) => void
}) {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [calError, setCalError] = useState('')
  useEffect(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const to = new Date(from.getTime() + 864e5)
    api(`calendar?from=${from.toISOString()}&to=${to.toISOString()}`).then((r) => { setEvents(r.events); setCalError(r.error) }, fail)
  }, [])

  const ranked = tasks.map((t) => ({ t, ...urgency(t) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 15)
  const reasons = Object.fromEntries(ranked.map((x) => [x.t.name, x.reasons]))
  const waiting = agents.filter((a) => a.state === 'needs-input')
  const done = (t: Doc) => api(`tasks/${t.name}`, 'PUT', { data: { status: 'done' } }).catch(fail)
  const meetingsToday = vault.meetings.filter((m) => String(m.data.date) === todayISO())

  return (
    <main className="home today">
      <section className="pane todos">
        <h2>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>

        {waiting.length > 0 && <>
          <h3>Agents waiting for you <span className="count">{waiting.length}</span></h3>
          <AgentList agents={waiting} vault={vault} copy={copy} seen={seen} openHere={openHere} />
        </>}

        <h3>Meetings today</h3>
        {calError && <p className="muted">{calError}</p>}
        <ul className="event-list">
          {events.map((e) => (
            <li key={e.id}>
              <span className="time">{e.allDay ? 'all day' : new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="todo-title">{e.title}</span>
              <button className="icon" onClick={() => prep(e.title, todayISO())}>+ prep</button>
              <button className="icon" onClick={() => meetingNote(e.title, todayISO())}>notes</button>
            </li>
          ))}
          {meetingsToday.map((m) => (
            <li key={m.name}><span className="time">note</span><span className="todo-title">{m.name}</span>
              <button className="icon" onClick={() => write(`meetings/${m.name}.md`)}>open</button></li>
          ))}
          {!events.length && !meetingsToday.length && !calError && <li className="muted">No meetings today.</li>}
        </ul>

        <h3>Plan</h3>
        <TodoList tasks={ranked.map((x) => x.t)} reasons={reasons} open={open} done={done} write={write} />
        <p className="muted hint">Ranked by overdue, due soon, in progress and priority. Ask the assistant to replan ("I have 2 hours, what first?").</p>
      </section>
      <Chat clearTask={() => {}} />
    </main>
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
