import { useEffect, useRef, useState } from 'react'
import { LABELS, PRIORITIES, api, list, prioLabel, unlink, type Doc, type Vault } from './lib'
import { MessagesSquare, Play, RotateCcw, X } from 'lucide-react'
import Split from './Split'
import { IconButton } from './ui'

const RANK: Record<string, number> = { wip: 0, review: 1, blocked: 2, todo: 3 }
const rank = (t: Doc) => RANK[t.data.status] ?? RANK.todo
const prio = (t: Doc) => { const i = PRIORITIES.indexOf(t.data.priority); return i < 0 ? 2 : i }

// localStorage can throw (private mode, blocked storage); the board works without it.
export function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
export function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* not persisted */ }
}

export type Seed = { task?: string; message: string; at: number }

// One project: its open tasks next to a chat that runs in the project's repo and account.
// In the side peek (`compact`) tasks and chat are tabs instead of two panes.
export default function ProjectPage({ vault, project, open, edit, fail, seed, write, terminal, start, compact }: {
  vault: Vault; project: Doc; open: (d: Doc) => void; edit: (d: Doc) => void; fail: (e: Error) => void; terminal: () => void; start: (d: Doc) => void
  seed?: Seed; write: (path: string) => void; compact?: boolean
}) {
  const [taskId, setTaskId] = useState<string | undefined>(seed?.task)
  const [newTitle, setNewTitle] = useState('')
  const [tab, setTab] = useState<'tasks' | 'chat'>(seed ? 'chat' : 'tasks')
  useEffect(() => { if (seed?.task) { setTaskId(seed.task); setTab('chat') } }, [seed])
  const chatAbout = (id?: string) => { setTaskId(id); if (id) setTab('chat') }

  const mine = vault.tasks.filter((t) => unlink(t.data.project) === project.name)
  const openTasks = mine.filter((t) => t.data.status !== 'done')
    .sort((a, b) => rank(a) - rank(b) || prio(a) - prio(b) || (Number(a.data.order) || 0) - (Number(b.data.order) || 0))
  const task = openTasks.find((t) => t.name === taskId)

  function add(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    api('tasks', 'POST', { data: { title: newTitle.trim(), project: `[[${project.name}]]` } }).then(() => setNewTitle(''), fail)
  }
  const done = (t: Doc) => api(`tasks/${t.name}`, 'PUT', { data: { status: 'done' } }).catch(fail)

  const head = (
    <div className="page-head">
      <h2>{project.data.name ?? project.name}</h2>
      <span className="muted">{project.data.account} account</span>
      <div className="spacer" />
      <button onClick={() => edit(project)}>Edit</button>
      <IconButton icon={Play} label="New agent" showLabel primary onClick={terminal} />
    </div>
  )
  const tasksPane = (
    <section className="pane todos">
      {!compact && head}
      <form onSubmit={add} className="quick-add">
        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add a task, press Enter" aria-label="New task title" />
      </form>
      <TodoList tasks={openTasks} selected={taskId} select={chatAbout} open={open} done={done} write={write} start={start} />
    </section>
  )
  const chat = <Chat key={project.name} project={project} task={task} clearTask={() => setTaskId(undefined)} seed={seed} />
  if (!compact) return <Split id="project">{tasksPane}{chat}</Split>
  return (
    <div className="project-peek">
      {head}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>Tasks <span className="count">{openTasks.length}</span></button>
        <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat{task ? ` · ${task.name}` : ''}</button>
      </div>
      {tab === 'tasks' ? tasksPane : chat}
    </div>
  )
}

export function TodoList({ tasks, projects, selected, select, open, done, write, reasons, start }: {
  tasks: Doc[]; projects?: Doc[]; selected?: string; select?: (id?: string) => void; open: (d: Doc) => void; done: (d: Doc) => void
  start?: (d: Doc) => void
  write: (path: string) => void; reasons?: Record<string, string[]>
}) {
  return (
    <ul className="todo-list">
      {tasks.map((t) => (
        <li key={t.name} className={`clickable ${t.name === selected ? 'on' : ''}`} onClick={() => open(t)}>
          <input type="checkbox" aria-label={`Mark ${t.name} done`} onClick={(e) => e.stopPropagation()} onChange={() => done(t)} />
          <span className="todo-body">
            {projects && (() => {
              const p = projects.find((x) => x.name === unlink(t.data.project))
              return <span className="todo-project"><span className={`dot ${p?.data.context ?? ''}`} />{p?.data.name ?? (unlink(t.data.project) || 'No project')}<span className="todo-id">{t.name}</span></span>
            })()}
            <span className="todo-title">{t.data.title ?? t.name}</span>
            <span className="todo-meta">
              <span className={`prio ${t.data.priority}`}>{prioLabel(t.data.priority)}</span>
              <span className={`status ${t.data.status}`}>{LABELS[t.data.status] ?? t.data.status}</span>
              {t.data.type && <span>{t.data.type}</span>}
              {t.data.due && <span>due {t.data.due}</span>}
              {reasons?.[t.name]?.filter((r) => !/^p\d$|^in progress$|^in review$/.test(r)).map((r) => <span key={r} className="reason">{r}</span>)}
            </span>
          </span>
          <span className="hover-actions">
            {start && <IconButton icon={Play} label="Start an agent on this task" stop onClick={() => start(t)} />}
            {select && <IconButton icon={MessagesSquare} label="Chat about this task" stop onClick={() => select(t.name)} />}
          </span>
        </li>
      ))}
      {!tasks.length && <li className="muted">Nothing open here.</li>}
    </ul>
  )
}

// Project picker over the projects in context; the current value stays listed even when it is out of context.
export function ProjectSelect({ projects, all, value, onChange, none, label = 'Project' }: {
  projects: Doc[]; all: Doc[]; value: string; onChange: (name: string) => void; none?: string; label?: string
}) {
  const current = !projects.some((p) => p.name === value) && all.find((p) => p.name === value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {none !== undefined && <option value="">{none}</option>}
      {[...(current ? [current] : []), ...projects].map((p) => <option key={p.name} value={p.name}>{p.data.name ?? p.name}</option>)}
    </select>
  )
}

type Msg ={ role: 'user' | 'assistant' | 'tool' | 'info' | 'error'; text: string }

function summarize(input: Record<string, any> = {}) {
  return String(input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.description ?? input.skill ?? '').slice(0, 120)
}

const GRILL = 'Grill me on this task before we build or write anything: one question at a time, each with your recommended answer. Look up facts yourself. Record settled decisions in the task under "## Decisions".'
const SPAR = 'Spar with me on this task (it is a design/ADR, not code): challenge my reasoning, point out options I missed, one point at a time. Record conclusions in the task under "## Decisions".'

// No project = the general assistant over the whole vault.
export function Chat({ project, task, clearTask, seed }: { project?: Doc; task?: Doc; clearTask: () => void; seed?: Seed }) {
  const key = `sb.chat.${project?.name ?? '_general'}`
  const [msgs, setMsgs] = useState<Msg[]>(() => load(key, { msgs: [] as Msg[] }).msgs)
  const [sessionId, setSessionId] = useState<string | undefined>(() => load(key, { sessionId: undefined }).sessionId)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<AbortController>()
  const end = useRef<HTMLDivElement>(null)
  const seeded = useRef(0)

  // ponytail: keeps the last 100 messages per chat in localStorage; the full history stays in Claude's session.
  useEffect(() => { save(key, { msgs: msgs.slice(-100), sessionId }) }, [key, msgs, sessionId])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs])
  useEffect(() => {
    if (seed && seed.at !== seeded.current && (!seed.task || seed.task === task?.name)) {
      seeded.current = seed.at
      send(seed.message === 'Grill' ? GRILL : seed.message)
    }
  }, [seed, task?.name])

  const push = (m: Msg) => setMsgs((all) => [...all, m])

  function onEvent(ev: any) {
    if (ev.type === 'meta') push({ role: 'info', text: `${ev.account} account · ${ev.cwd}` })
    else if (ev.type === 'system' && ev.subtype === 'init') setSessionId(ev.session_id)
    else if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'text' && c.text.trim()) push({ role: 'assistant', text: c.text })
        if (c.type === 'tool_use') push({ role: 'tool', text: `${c.name} ${summarize(c.input)}` })
      }
    } else if (ev.type === 'result') {
      setSessionId(ev.session_id)
      if (ev.is_error) push({ role: 'error', text: String(ev.result ?? 'Claude reported an error') })
      const denied = list(ev.permission_denials?.map((d: any) => d.tool_name))
      if (denied.length) push({ role: 'info', text: `Needed your permission for: ${[...new Set(denied)].join(', ')}. Use ▶ on the task to continue in a terminal.` })
    } else if (ev.type === 'error') push({ role: 'error', text: ev.error })
  }

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy) return
    push({ role: 'user', text: task ? `[${task.name}] ${message}` : message })
    const ctrl = new AbortController()
    setBusy(ctrl)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: project?.name, task: task?.name, message, sessionId }),
      })
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        const lines = buf.split('\n')
        buf = lines.pop()!
        for (const line of lines) {
          try { if (line.trim()) onEvent(JSON.parse(line)) } catch { /* non-JSON noise from the CLI */ }
        }
      }
    } catch (err: any) {
      push({ role: err.name === 'AbortError' ? 'info' : 'error', text: err.name === 'AbortError' ? 'Stopped.' : err.message })
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section className="pane chat">
      <div className="chat-head">
        <h2>{project ? 'Chat' : 'Ask Claude'}</h2>
        {task && <span className="chip">about {task.name} <IconButton icon={X} label="Stop chatting about this task" onClick={clearTask} /></span>}
        <div className="spacer" />
        {task && <>
          <button className="icon" disabled={!!busy} onClick={() => send(GRILL)} title="Interview me about this task">Grill</button>
          <button className="icon" disabled={!!busy} onClick={() => send(SPAR)} title="Challenge my thinking (ADRs, designs)">Spar</button>
        </>}
        <IconButton icon={RotateCcw} label="New chat" disabled={!!busy} onClick={() => { setMsgs([]); setSessionId(undefined) }} />
      </div>
      <div className="messages" aria-live="polite">
        {!msgs.length && <p className="chat-intro">{project
          ? `Ask anything about ${project.data.name ?? project.name}. Claude runs in the project repo with the ${project.data.account} account. Select a task to Grill or Spar.`
          : 'Ask Claude a question or give it a job: "what is due this week?", "what did we decide with UHasselt?", "move the portal tasks to next week". It sees your whole vault and can change it. Only want to write something down? Use New thought (⌘⇧K): saved as-is, no AI, filed later.'}</p>}
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.text}</div>)}
        {busy && <div className="msg info">Claude is working…</div>}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); setInput('') }}>
        <textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)} placeholder={task ? `Message about ${task.name}…` : project ? `Ask about ${project.data.name ?? project.name}…` : 'Ask Claude…'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
        {busy
          ? <button type="button" onClick={() => busy.abort()}>Stop</button>
          : <button type="submit" className="primary">Send</button>}
      </form>
    </section>
  )
}
