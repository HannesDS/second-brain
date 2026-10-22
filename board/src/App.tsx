import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { marked } from 'marked'
import Calendar, { guessProject } from './Calendar'
import Gantt from './Gantt'
import ProjectPage, { load as loadLocal, save as saveLocal, type Seed } from './Home'
import Notes from './Notes'
import Terminals from './Terminals'
import Today, { Agents } from './Today'

import {
  CONTEXTS, LABELS, LIST_FIELDS, PRIORITIES, STATUSES, TYPES, api, byOrder, columnOf, list, obsidian, startCommand, unlink,
  type Agent, type Doc, type Fields, type Vault,
} from './lib'

type Page = 'today' | 'project' | 'notes' | 'calendar' | 'board' | 'gantt' | 'projects' | 'agents' | 'terminals' | 'guide'
const NAV: [Page, string, string][] = [
  ['today', 'My day', '☀'], ['notes', 'Notes', '✎'], ['calendar', 'Calendar', '▦'], ['board', 'Board', '▤'],
  ['gantt', 'Timeline', '≡'], ['projects', 'Projects', '◫'], ['agents', 'Agents', '◉'], ['terminals', 'Terminals', '›_'], ['guide', 'Guide', '?'],
]

// Routes live in the URL hash (#notes/inbox%2Fx.md, #project/portal) so back/forward and reloads work.
const parseHash = (): { page: Page; arg: string } => {
  const [page, ...rest] = location.hash.slice(1).split('/')
  return { page: (NAV.some(([p]) => p === page) || page === 'project' ? page : 'today') as Page, arg: decodeURIComponent(rest.join('/')) }
}

export default function App() {
  const [vault, setVault] = useState<Vault>()
  const [agents, setAgents] = useState<Agent[]>([])
  const [sync, setSync] = useState<Record<string, string>>({})
  const [route, setRoute] = useState(parseHash)
  const [context, setContext] = useState('')
  const [prios, setPrios] = useState<string[]>([])
  const [editing, setEditing] = useState<{ kind: 'task' | 'project'; doc?: Doc }>()
  const [seed, setSeed] = useState<Seed>()
  const [seen, setSeen] = useState<Record<string, string>>(() => loadLocal('sb.seen', {}))
  const [toast, setToast] = useState('')

  const load = useCallback(() => api('data').then(setVault), [])
  const loadAgents = useCallback(() => api('agents').then(setAgents), [])
  useEffect(() => {
    load()
    loadAgents()
    api('sync').then(setSync)
    let timer: number
    const onChange = () => { clearTimeout(timer); timer = window.setTimeout(load, 100) }
    const onAgents = () => { clearTimeout(timer); timer = window.setTimeout(loadAgents, 300) }
    const onHash = () => setRoute(parseHash())
    import.meta.hot?.on('vault-change', onChange)
    import.meta.hot?.on('agents-change', onAgents)
    window.addEventListener('hashchange', onHash)
    const poll = window.setInterval(() => { loadAgents(); api('sync').then(setSync) }, 60_000)
    return () => {
      import.meta.hot?.off('vault-change', onChange)
      import.meta.hot?.off('agents-change', onAgents)
      window.removeEventListener('hashchange', onHash)
      clearInterval(poll)
    }
  }, [load, loadAgents])

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }
  const fail = (e: Error) => flash(e.message)
  const go = (page: Page, arg = '') => { location.hash = arg ? `${page}/${encodeURIComponent(arg)}` : page }

  if (!vault) return <div className="empty">Loading vault…</div>
  const projects = Object.fromEntries(vault.projects.map((p) => [p.name, p]))
  const visible = vault.tasks.filter((t) => {
    const p = projects[unlink(t.data.project)]
    return (!context || p?.data.context === context) && (!prios.length || prios.includes(t.data.priority))
  })
  const { page, arg } = route
  // A "needs you" that was marked seen shows as idle until the session changes again.
  const shown = agents.map((a) => (a.state === 'needs-input' && seen[a.id] === a.updated ? { ...a, state: 'idle' } : a))
  const markSeen = (a: Agent) => { const next = { ...seen, [a.id]: a.updated }; setSeen(next); saveLocal('sb.seen', next) }
  const project = page === 'project' ? projects[arg] : undefined
  const openTask = (doc?: Doc) => setEditing({ kind: 'task', doc })
  const write = (path: string) => go('notes', path)
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => flash(`${what} copied`), fail)
  const copyStart = (t: Doc) => copy(startCommand(t, projects[unlink(t.data.project)], vault.root), 'Start command')
  const prep = (title: string, date: string, prefix = 'Prep: ') => {
    const p = guessProject(title, vault.projects)
    api('tasks', 'POST', { data: { title: `${prefix}${title}`, project: p ? `[[${p}]]` : '', type: 'meeting', priority: 'p1', due: date } })
      .then(({ id }) => flash(`${id} created: Prep: ${title}`), fail)
  }
  const meetingNote = (title: string, date: string, time = '') =>
    api('meetings', 'POST', { title, date, time, project: guessProject(title, vault.projects) }).then(({ path }) => write(path), fail)
  const terminal = (body: Record<string, string>) => api('terminals', 'POST', body).then(({ id }) => go('terminals', id), fail)
  const grill = (t: Doc) => { setEditing(undefined); setSeed({ task: t.name, message: 'Grill', at: Date.now() }); go('project', unlink(t.data.project)) }
  const waiting = shown.filter((a) => a.state === 'needs-input').length
  const openCount = (p: Doc) => vault.tasks.filter((t) => unlink(t.data.project) === p.name && t.data.status !== 'done').length

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Second Brain</div>
        <Search vault={vault} openTask={openTask} write={write} />
        <div className="side-actions">
          <button className="primary" onClick={() => openTask()}>+ Task</button>
          <button onClick={() => api('notes', 'POST', { title: '' }).then(({ path }) => write(path), fail)}>+ Note</button>
        </div>
        <nav className="side-nav">
          {NAV.map(([id, label, icon]) => (
            <button key={id} className={page === id ? 'nav on' : 'nav'} aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}>
              <span className="nav-icon" aria-hidden>{icon}</span>{label}
              {id === 'agents' && waiting > 0 && <span className="badge" title="Agents waiting for you">{waiting}</span>}
            </button>
          ))}
        </nav>

        <div className="side-section">Filter</div>
        <div className="prio-filter" role="group" aria-label="Priority filter">
          {PRIORITIES.map((p) => (
            <button key={p} className={`prio-chip ${p} ${prios.includes(p) ? 'on' : ''}`} aria-pressed={prios.includes(p)}
              onClick={() => setPrios(prios.includes(p) ? prios.filter((x) => x !== p) : [...prios, p])}>{p}</button>
          ))}
        </div>
        <select value={context} onChange={(e) => setContext(e.target.value)} aria-label="Context filter">
          <option value="">All contexts</option>
          {CONTEXTS.map((c) => <option key={c}>{c}</option>)}
        </select>

        <div className="side-section">Projects <button className="icon" title="New project" onClick={() => setEditing({ kind: 'project' })}>+</button></div>
        <nav className="side-projects">
          {vault.projects.filter((p) => p.data.status !== 'done' && (!context || p.data.context === context)).map((p) => (
            <button key={p.name} className={project === p ? 'nav on' : 'nav'} onClick={() => go('project', p.name)}>
              <span className={`dot ${p.data.context}`} />
              <span className="proj-name">{p.data.name ?? p.name}</span>
              {openCount(p) > 0 && <span className="count">{openCount(p)}</span>}
            </button>
          ))}
        </nav>

        <div className="side-foot">
          <span title={sync.error || ''}>Notion: {sync.notion || '…'}</span>
          <button className="icon" onClick={() => api('sync', 'POST').then(setSync, fail)}>sync</button>
        </div>
      </aside>

      <div className="main">
        {page === 'today' && <Today vault={vault} tasks={visible} agents={shown} seen={markSeen} openHere={(a) => terminal({ kind: 'resume', agent: a.id })} open={openTask} write={write} fail={fail} copy={copy} prep={prep} meetingNote={meetingNote} />}
        {page === 'project' && project && <ProjectPage vault={vault} project={project} terminal={() => terminal({ kind: 'claude', project: project.name })} open={openTask} edit={(doc) => setEditing({ kind: 'project', doc })} fail={fail} seed={seed} write={write} />}
        {page === 'project' && !project && <div className="empty">Unknown project "{arg}".</div>}
        {page === 'notes' && <Notes vault={vault} path={arg || undefined} go={write} fail={fail} flash={flash} />}
        {page === 'calendar' && <Calendar vault={vault} tasks={visible} open={openTask} write={write} prep={prep} meetingNote={meetingNote} fail={fail} />}
        {page === 'board' && <Board tasks={visible} setVault={setVault} vault={vault} projects={projects} fail={fail} open={openTask} start={copyStart} />}
        {page === 'gantt' && <Gantt tasks={visible} projects={projects} open={openTask} fail={fail} />}
        {page === 'projects' && <Projects vault={vault} go={(p) => go('project', p)} edit={(doc) => setEditing({ kind: 'project', doc })} />}
        {page === 'agents' && <Agents agents={shown} vault={vault} copy={copy} seen={markSeen} openHere={(a) => terminal({ kind: 'resume', agent: a.id })} />}
        {page === 'terminals' && <Terminals active={arg || undefined} go={(id) => go('terminals', id)} fail={fail} />}
        {page === 'guide' && <Guide />}
      </div>

      {editing?.kind === 'task' && <TaskPanel key={editing.doc?.name ?? 'new'} doc={editing.doc} vault={vault}
        defaultProject={project?.name ?? ''} close={() => setEditing(undefined)} fail={fail} start={copyStart} startHere={(t) => { setEditing(undefined); terminal({ kind: 'claude', task: t.name }) }} write={(p) => { setEditing(undefined); write(p) }} grill={grill} />}
      {editing?.kind === 'project' && <ProjectPanel key={editing.doc?.name ?? 'new'} doc={editing.doc}
        close={() => setEditing(undefined)} fail={fail} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function Search({ vault, openTask, write }: { vault: Vault; openTask: (d: Doc) => void; write: (p: string) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ path: string; dir: string; name: string; title: string; snippet: string }[]>([])
  useEffect(() => {
    if (q.trim().length < 2) return setHits([])
    const t = setTimeout(() => api(`search?q=${encodeURIComponent(q)}`).then(setHits), 200)
    return () => clearTimeout(t)
  }, [q])
  const pick = (h: (typeof hits)[number]) => {
    setQ('')
    const task = h.dir === 'tasks' && vault.tasks.find((t) => t.name === h.name)
    if (task) openTask(task)
    else write(h.path)
  }
  return (
    <div className="search">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything…" aria-label="Search the vault"
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) pick(hits[0]); if (e.key === 'Escape') setQ('') }} />
      {hits.length > 0 && (
        <ul className="search-hits" role="listbox">
          {hits.map((h) => (
            <li key={h.path} role="option" aria-selected={false} onClick={() => pick(h)}>
              <span className="chip">{h.dir}</span> <strong>{h.title}</strong>
              {h.snippet && <div className="muted">…{h.snippet}…</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Board({ tasks, vault, setVault, projects, fail, open, start }: {
  tasks: Doc[]; vault: Vault; setVault: (v: Vault) => void; projects: Record<string, Doc>
  fail: (e: Error) => void; open: (d: Doc) => void; start: (d: Doc) => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [active, setActive] = useState<Doc>()
  const columns = useMemo(() => {
    const cols: Record<string, Doc[]> = Object.fromEntries(STATUSES.map((s) => [s, []]))
    for (const t of tasks) (cols[columnOf(t)] ??= []).push(t)
    for (const c of Object.values(cols)) c.sort(byOrder)
    return cols
  }, [tasks])

  function onDragEnd({ active: a, over }: DragEndEvent) {
    setActive(undefined)
    if (!over) return
    const task = tasks.find((t) => t.name === a.id)!
    const from = columnOf(task)
    const overId = String(over.id)
    const to = overId.startsWith('col:') ? overId.slice(4) : columnOf(tasks.find((t) => t.name === overId)!)
    if (to === '?') return
    let target: Doc[]
    if (from === to) {
      const col = columns[to]
      const newIndex = overId.startsWith('col:') ? col.length - 1 : col.findIndex((t) => t.name === overId)
      target = arrayMove(col, col.indexOf(task), newIndex)
    } else {
      target = [...columns[to]]
      const i = target.findIndex((t) => t.name === overId)
      target.splice(i < 0 ? target.length : i, 0, task)
    }
    // ponytail: reorders only the visible (filtered) cards, so hidden cards may share an order value.
    const moves = target
      .map((t, order) => ({ id: t.name, status: to, order }))
      .filter((m, i) => target[i].data.status !== m.status || Number(target[i].data.order) !== m.order)
    if (!moves.length) return
    const patch = Object.fromEntries(moves.map((m) => [m.id, m]))
    setVault({ ...vault, tasks: vault.tasks.map((t) => patch[t.name] ? { ...t, data: { ...t.data, ...patch[t.name] } } : t) })
    api('move', 'POST', moves).catch(fail)
  }

  const cols = columns['?']?.length ? [...STATUSES, '?'] : STATUSES
  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}
      onDragStart={(e) => setActive(tasks.find((t) => t.name === e.active.id))} onDragCancel={() => setActive(undefined)}>
      <main className="board">
        {cols.map((s) => (
          <Column key={s} status={s} tasks={columns[s]}>
            {columns[s].map((t) => <SortableCard key={t.name} task={t} project={projects[unlink(t.data.project)]} open={open} start={start} />)}
          </Column>
        ))}
      </main>
      <DragOverlay>{active && <Card task={active} project={projects[unlink(active.data.project)]} />}</DragOverlay>
    </DndContext>
  )
}

function Column({ status, tasks, children }: { status: string; tasks: Doc[]; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` })
  return (
    <section className={`column ${isOver ? 'over' : ''}`} ref={setNodeRef} data-status={status}>
      <h2>{LABELS[status]} <span className="count">{tasks.length}</span></h2>
      <SortableContext items={tasks.map((t) => t.name)} strategy={verticalListSortingStrategy}>
        <div className="cards">{children}</div>
      </SortableContext>
    </section>
  )
}

function SortableCard(props: { task: Doc; project?: Doc; open: (d: Doc) => void; start: (d: Doc) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.name })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes} {...listeners} onClick={() => props.open(props.task)}>
      <Card {...props} />
    </div>
  )
}

function Card({ task, project, start }: { task: Doc; project?: Doc; start?: (d: Doc) => void }) {
  const d = task.data
  return (
    <article className="card">
      <div className="card-top">
        <span className={`prio ${d.priority}`}>{d.priority ?? 'p?'}</span>
        <span className="project">{project?.data.name ?? (unlink(d.project) || 'No project')}</span>
        <span className="id">{task.name}</span>
      </div>
      <div className="title">{d.title ?? task.name}</div>
      {task.error && <div className="blocked">Invalid frontmatter, fix in Obsidian</div>}
      {d.blocked_by && <div className="blocked">⛔ {unlink(d.blocked_by)}</div>}
      <div className="card-bottom">
        <span className="type">{d.type}</span>
        {d.due && <span className="due">due {d.due}</span>}
        <div className="spacer" />
        {d.pr && <a href={d.pr} target="_blank" rel="noreferrer" title="Pull request" onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}>PR ↗</a>}
        {start && <button className="icon" title="Copy start command" onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); start(task) }}>▶</button>}
      </div>
    </article>
  )
}

function Projects({ vault, go, edit }: { vault: Vault; go: (id: string) => void; edit: (d: Doc) => void }) {
  return (
    <main className="project-cards">
      {vault.projects.map((p) => {
        const mine = vault.tasks.filter((t) => unlink(t.data.project) === p.name)
        const total = mine.length || 1
        const next = mine.filter((t) => t.data.status !== 'done' && t.data.due).sort((a, b) => String(a.data.due).localeCompare(String(b.data.due)))[0]
        return (
          <article key={p.name} className={`project-card ${p.data.status}`} tabIndex={0} onClick={() => go(p.name)} onKeyDown={(e) => e.key === 'Enter' && go(p.name)}>
            <div className="card-top">
              <span className={`mono ${p.data.context}`} title={p.data.account === 'personal' ? 'beeld-bit (personal account)' : 'Data Minded (dm account)'}>{p.data.account === 'personal' ? 'bb' : 'DM'}</span>
              <span className={`ctx ${p.data.context}`}>{p.data.context}</span>
              <div className="spacer" />
              <button className="icon" title="Edit project" onClick={(e) => { e.stopPropagation(); edit(p) }}>✎</button>
            </div>
            <h3>{p.data.name ?? p.name}</h3>
            <div className="status-bar" aria-label="Tasks per status">
              {STATUSES.map((s) => {
                const n = mine.filter((t) => t.data.status === s).length
                return n ? <span key={s} className={`seg ${s}`} style={{ flex: n / total }} title={`${LABELS[s]}: ${n}`} /> : null
              })}
            </div>
            <div className="muted">
              {STATUSES.filter((s) => s !== 'done').map((s) => `${mine.filter((t) => t.data.status === s).length} ${LABELS[s].toLowerCase()}`).join(' · ')}
            </div>
            {next && <div className="muted">Next due: {next.data.due} · {next.data.title}</div>}
          </article>
        )
      })}
    </main>
  )
}

// Lists are edited as one item per line.
const toText = (v: unknown) => list(v).join('\n')
const fromText = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)

function Panel({ title, close, children, onSave }: { title: string; close: () => void; children: React.ReactNode; onSave: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="panel" role="dialog" aria-label={title}>
        <form onSubmit={(e) => { e.preventDefault(); onSave() }}>
          <div className="panel-head">
            <h2>{title}</h2>
            <button type="button" className="icon" onClick={close} aria-label="Close">✕</button>
          </div>
          {children}
          <div className="panel-foot">
            <button type="button" onClick={close}>Cancel</button>
            <button type="submit" className="primary">Save</button>
          </div>
        </form>
      </aside>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function TaskPanel({ doc, vault, defaultProject, close, fail, start, startHere, write, grill }: {
  doc?: Doc; vault: Vault; defaultProject: string; close: () => void; fail: (e: Error) => void; start: (d: Doc) => void; startHere: (d: Doc) => void
  write: (path: string) => void; grill: (d: Doc) => void
}) {
  const init = doc?.data ?? { status: 'todo', priority: 'p2', type: 'code', project: defaultProject ? `[[${defaultProject}]]` : '' }
  const [f, setF] = useState<Fields>(() => ({ ...init, ...Object.fromEntries(LIST_FIELDS.map((k) => [k, toText(init[k])])) }))
  const [body, setBody] = useState(doc?.body ?? '')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const input = (k: string, type = 'text') => <input type={type} value={f[k] ?? ''} onChange={set(k)} />
  const select = (k: string, opts: string[]) => <select value={f[k] ?? ''} onChange={set(k)}>{opts.map((o) => <option key={o}>{o}</option>)}</select>

  function save() {
    if (!f.title?.trim()) return fail(new Error('Title is required'))
    const data = { ...f, ...Object.fromEntries(LIST_FIELDS.map((k) => [k, fromText(f[k])])) }
    const req = doc ? api(`tasks/${doc.name}`, 'PUT', { data, body }) : api('tasks', 'POST', { data, body })
    req.then(close, fail)
  }

  // Meetings linked from the task, plus meetings that link to it.
  const meetings = doc ? [...new Set([
    ...list(doc.data.meetings).map(unlink),
    ...vault.meetings.filter((m) => list(m.data.tasks).map(unlink).includes(doc.name)).map((m) => m.name),
  ])] : []

  return (
    <Panel title={doc ? doc.name : 'New task'} close={close} onSave={save}>
      {doc?.error && <p className="blocked">Invalid frontmatter: {doc.error}. Fix it in Obsidian; saving is disabled until then.</p>}
      {doc && (
        <div className="links">
          <div className="link-actions">
            <button type="button" className="primary" onClick={() => startHere(doc)} title="Claude in a workbench terminal, in the task's repo, linked to this task">▶ Start here</button>
            <button type="button" onClick={() => grill(doc)} title="Interview me in the project chat">Grill</button>
            <button type="button" onClick={() => write(`tasks/${doc.name}.md`)}>¶ Write</button>
            {doc.data.notion && <a className="btn" href={doc.data.notion} target="_blank" rel="noreferrer">Notion ↗</a>}
            {doc.data.pr && <a className="btn" href={doc.data.pr} target="_blank" rel="noreferrer">PR #{String(doc.data.pr).split('/').pop()} ↗</a>}
            <a className="btn" href={obsidian(`${vault.vault}/tasks/${doc.name}.md`)}>Obsidian</a>
            <button type="button" className="icon" onClick={() => start(doc)} title="Copy a start command for your own terminal">copy cmd</button>
          </div>
          {(meetings.length > 0 || list(doc.data.sources).length > 0 || list(doc.data.sessions).length > 0) && (
            <div className="link-chips">
              {meetings.map((m) => <button type="button" key={m} className="chip" onClick={() => write(`meetings/${m}.md`)}>🗒 {m}</button>)}
              {list(doc.data.sources).filter((x) => x !== doc.data.pr && x !== doc.data.notion).map((x) => /^https?:/.test(x)
                ? <a key={x} className="chip" href={x} target="_blank" rel="noreferrer">{x.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)} ↗</a>
                : <span key={x} className="chip">{x}</span>)}
              {list(doc.data.sessions).map((x) => <span key={x} className="chip" title={x}>session {x.slice(0, 8)}</span>)}
            </div>
          )}
        </div>
      )}
      <Field label="Title"><input autoFocus value={f.title ?? ''} onChange={set('title')} required /></Field>
      <div className="row">
        <Field label="Project">
          <select value={unlink(f.project)} onChange={(e) => setF({ ...f, project: e.target.value ? `[[${e.target.value}]]` : '' })}>
            <option value="">None</option>
            {vault.projects.map((p) => <option key={p.name} value={p.name}>{p.data.name ?? p.name}</option>)}
          </select>
        </Field>
        <Field label="Status">{select('status', STATUSES)}</Field>
      </div>
      <div className="row">
        <Field label="Priority">{select('priority', PRIORITIES)}</Field>
        <Field label="Type">{select('type', TYPES)}</Field>
      </div>
      <div className="row">
        <Field label="Start">{input('start', 'date')}</Field>
        <Field label="Due">{input('due', 'date')}</Field>
      </div>
      <Field label="Notion page (the team's ticket; status syncs)">{input('notion', 'url')}</Field>
      <Field label="Blocked by">{input('blocked_by')}</Field>
      <div className="row">
        <Field label="Repo">{input('repo')}</Field>
        <Field label="Branch">{input('branch')}</Field>
      </div>
      <Field label="PR url">{input('pr', 'url')}</Field>
      <Field label="Meetings (one per line, [[name]])"><textarea rows={2} value={f.meetings} onChange={set('meetings')} /></Field>
      <Field label="Sources (one per line)"><textarea rows={2} value={f.sources} onChange={set('sources')} /></Field>
      <Field label="Sessions (one per line)"><textarea rows={2} value={f.sessions} onChange={set('sessions')} /></Field>
      <Field label="Notes (markdown)"><textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>

    </Panel>
  )
}

function ProjectPanel({ doc, close, fail }: { doc?: Doc; close: () => void; fail: (e: Error) => void }) {
  const init = doc?.data ?? { context: 'dataminded', account: 'dm', status: 'active' }
  const [f, setF] = useState<Fields>({ ...init, id: init.id ?? doc?.name ?? '', repos: toText(init.repos) })
  const [body, setBody] = useState(doc?.body ?? '')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const select = (k: string, opts: string[]) => <select value={f[k] ?? ''} onChange={set(k)}>{opts.map((o) => <option key={o}>{o}</option>)}</select>

  function save() {
    if (!/^[\w.-]+$/.test(f.id)) return fail(new Error('Id: letters, digits, - and _ only'))
    const data = { ...f, repos: fromText(f.repos) }
    const req = doc ? api(`projects/${doc.name}`, 'PUT', { data, body }) : api('projects', 'POST', { data, body })
    req.then(close, fail)
  }

  return (
    <Panel title={doc ? (doc.data.name ?? doc.name) : 'New project'} close={close} onSave={save}>
      <div className="row">
        <Field label="Id"><input value={f.id} onChange={set('id')} disabled={!!doc} required /></Field>
        <Field label="Name"><input autoFocus value={f.name ?? ''} onChange={set('name')} required /></Field>
      </div>
      <div className="row">
        <Field label="Context">{select('context', CONTEXTS)}</Field>
        <Field label="Account">{select('account', ['dm', 'personal'])}</Field>
        <Field label="Status">{select('status', ['active', 'paused', 'done'])}</Field>
      </div>
      <Field label="Repos (one per line, path or url)"><textarea rows={3} value={f.repos} onChange={set('repos')} /></Field>
      <Field label="Notes (markdown)"><textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
    </Panel>
  )
}

// Renders vault/notes/Guide.md, a file you write yourself, so the HTML is trusted.
function Guide() {
  const [html, setHtml] = useState('')
  useEffect(() => {
    fetch('/api/guide').then((r) => r.text()).then((md) => setHtml(marked.parse(md) as string))
  }, [])
  return <main className="guide" dangerouslySetInnerHTML={{ __html: html }} />
}
