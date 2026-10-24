import { EyeOff, Mountain, Play, TerminalSquare } from 'lucide-react'
import { IconButton } from './ui'
import { useEffect, useRef, useState } from 'react'
import { ProjectSelect } from './Home'
import { Cairns, CairnForm, type Running } from './Cairns'
import { ChooseWay, Trail, type Meeting } from './Trail'
import {
  cairnInContext, cairnMarks, cairnOf, goalOf, hhmm, isDone, isDue, meetingSpans, minuteOf, openStretches, trailSpan,
  type CalEvent, type Cairn, type Stretch, type Way,
} from './day'
import { agentLabel, ago, api, byProject, dayRange, todayISO, unlink, urgency, type Agent, type Doc, type Vault } from './lib'

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

// A browser notification, only when you allowed them; the toast shows either way.
const notify = (text: string) => { try { if (Notification.permission === 'granted') new Notification(text) } catch { /* no Notification API */ } }

// My day: the trail between today's meetings, the cairns due today, what's due, and your board (the real one,
// so you can drag). Agents show on their cards. Every row and card opens what it shows; secondary actions appear on hover.
export default function Today({ vault, tasks, context, act, fail, flash, prep, meetingNote, board }: {
  vault: Vault; tasks: Doc[]; context: string; act: Actions
  fail: (e: Error) => void; flash: (msg: string) => void; prep: (title: string, date: string) => void; meetingNote: (title: string, date: string, time?: string) => void
  board: React.ReactNode
}) {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [calError, setCalError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [choosing, setChoosing] = useState<Stretch>()
  const [editing, setEditing] = useState<{ cairn?: Cairn }>()
  const [running, setRunning] = useState<Running>()
  useEffect(() => {
    const { from, to } = dayRange(new Date())
    api(`calendar?from=${from.toISOString()}&to=${to.toISOString()}`).then((r) => { setEvents(r.events); setCalError(r.error) }, fail)
  }, [])
  // Every second while a timer runs, else twice a minute: enough for the now marker and the nudges.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), running ? 1000 : 30_000)
    return () => clearInterval(t)
  }, [running])

  const today = todayISO()
  const day = vault.days.find((d) => d.name === today)?.data ?? {}
  const log: Record<string, unknown> = day.cairns ?? {}
  const ways: Record<string, Way> = day.ways ?? {}
  const patchDay = (patch: Record<string, unknown>) => api(`days/${today}`, 'PUT', patch).catch(fail)

  // Overdue and due in the next two days, most urgent first.
  const due = tasks.map((t) => ({ t, ...urgency(t) })).filter((x) => x.reasons.some((r) => /overdue|due/.test(r))).sort((x, y) => y.score - x.score)
  const notesToday = vault.meetings.filter((m) => String(m.data.date) === today)
  const noteFor = (title: string) => notesToday.find((m) => m.name.toLowerCase().endsWith(title.toLowerCase().replace(/[\\/:*?"<>|#^[\]]/g, '').trim()))
  const timed = meetingSpans(events, now).map((m) => ({ ...m, title: m.event.title, note: noteFor(m.event.title) }))
  // Meeting notes without a calendar event show at their time, half an hour long; they don't cut the stretches.
  const loose: Meeting[] = notesToday.filter((n) => !timed.some((m) => m.note === n) && /^\d{2}:\d{2}$/.test(String(n.data.time ?? '')))
    .map((n) => { const [h, mi] = String(n.data.time).split(':').map(Number); return { start: h * 60 + mi, end: h * 60 + mi + 30, title: n.name.replace(/^\d{4}-\d{2}-\d{2} /, ''), note: n } })
  const span = trailSpan([...timed, ...loose])
  const stretches = openStretches(timed, span)
  const minute = minuteOf(now)
  const cairns = vault.cairns.map(cairnOf).filter((c) => isDue(c, now) && cairnInContext(context, c))
    .sort((a, b) => (cairnMarks(a, timed)[0] ?? 24 * 60) - (cairnMarks(b, timed)[0] ?? 24 * 60))

  // Nudges: a cairn's time comes, or a meeting ends that a cairn follows. Checked on each tick for what happened
  // since the last one, so nothing from before the page opened goes off.
  const last = useRef(minute)
  useEffect(() => {
    const from = last.current
    last.current = minute
    if (minute <= from) return
    const passed = (m: number) => m > from && m <= minute
    for (const c of cairns) {
      if (isDone(c, log[c.slug], goalOf(c, timed.length))) continue
      const ended = c.after ? cairnMarks(c, timed).findIndex(passed) : -1
      if (ended >= 0) { flash(`${timed[ended].title} is over. Time for ${c.name.toLowerCase()}.`); if (c.nudge) notify(`${c.name}: ${timed[ended].title} is over`) }
      else if (!c.after && c.at && passed(cairnMarks(c, timed)[0])) { flash(`Time for ${c.name.toLowerCase()}.`); if (c.nudge) notify(`Time for ${c.name.toLowerCase()}`) }
    }
  }, [minute])
  // A timer that ran out ticks its cairn.
  useEffect(() => {
    if (!running || now.getTime() < running.ends) return
    const c = cairns.find((x) => x.slug === running.slug)
    setRunning(undefined)
    if (c) { patchDay({ cairns: { [c.slug]: 'done' } }); flash(`${c.name}: done`) }
  }, [now, running])

  const openMeeting = (m: Meeting) => (m.note ? act.write(`meetings/${m.note.name}.md`) : meetingNote(m.title, today, hhmm(m.start)))
  const planFrom = stretches.find((s) => s.end > minute) ?? stretches[0]
  const saveCairn = (slug: string, data: Record<string, unknown>, isNew: boolean) => {
    try { if (data.nudge && Notification.permission === 'default') Notification.requestPermission() } catch { /* no Notification API */ }
    api(`cairns/${slug}`, isNew ? 'POST' : 'PUT', { data }).then(() => setEditing(undefined), fail)
  }
  const removeCairn = (c: Cairn) => {
    if (confirm(`Delete the cairn ${c.name}? Its file cairns/${c.slug}.md goes; the day files keep what you did.`)) api(`cairns/${c.slug}`, 'DELETE').catch(fail)
  }
  return (
    <main className="today">
      <div className="today-head">
        <div>
          <p className="today-date">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <p className="today-sum">{timed.length} meetings · {stretches.length} open stretches · {cairns.length} cairns</p>
        </div>
        {planFrom && <IconButton icon={Mountain} label="Plan my way" showLabel primary onClick={() => setChoosing(planFrom)} />}
      </div>
      {calError && <p className="muted">{calError}</p>}

      <Trail span={span} now={minute} meetings={[...timed, ...loose].sort((a, b) => a.start - b.start)} stretches={stretches} ways={ways}
        cairns={cairns} log={log} tasks={tasks} projects={vault.projects} openMeeting={openMeeting} prep={(title) => prep(title, today)} choose={setChoosing} />

      <Cairns cairns={cairns} log={log} days={vault.days} meetings={timed.length} now={now} running={running}
        tick={(c, value) => patchDay({ cairns: { [c.slug]: value } })} add={(c) => patchDay({ add: { [c.slug]: 1 } })}
        start={(c) => setRunning({ slug: c.slug, ends: Date.now() + c.minutes * 60_000 })} stop={() => setRunning(undefined)}
        edit={(cairn) => setEditing({ cairn })} remove={removeCairn} />

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

      <section>
        <h3>Your board <span className="muted hint-inline">drag cards to change status</span></h3>
        {board}
      </section>

      {choosing && <ChooseWay stretch={choosing} way={ways[hhmm(choosing.start)]} tasks={tasks} projects={vault.projects}
        save={(way) => patchDay({ ways: { [hhmm(choosing.start)]: way } })} close={() => setChoosing(undefined)} />}
      {editing && <CairnForm cairn={editing.cairn} taken={vault.cairns.map((c) => c.name)} save={saveCairn} close={() => setEditing(undefined)} />}
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
        <button type="submit" className="primary with-icon"><Play size={14} strokeWidth={1.8} aria-hidden /> Start agent</button>
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
