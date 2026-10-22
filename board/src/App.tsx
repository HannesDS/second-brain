import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { marked } from 'marked'
import {
  Bot, CalendarDays, FolderKanban, Pencil, GanttChart, HelpCircle, KanbanSquare, NotebookPen, Play, Plus, RefreshCw, Sparkles, Star, Sun, X,
  type LucideIcon,
} from 'lucide-react'
import { Peek, TaskPage, TerminalPeek, type PeekItem } from './Peek'
import { Editor } from './Notes'
import { IconButton } from './ui'
import Calendar, { guessProject } from './Calendar'
import Gantt from './Gantt'
import ProjectPage, { Chat, load as loadLocal, save as saveLocal, type Seed } from './Home'
import Notes from './Notes'
import Split from './Split'
import Terminals from './Terminals'
import Today, { Agents, type Actions } from './Today'

import {
  CONTEXTS, CONTEXT_LABEL, FOCUS_MAX, LABELS, PRIORITIES, PRIO_LABEL, prioLabel, STATUSES, api, byOrder, columnOf, isFocus, list,
  contextOf, inContext, scopeVault, startCommand, unlink,
  type Agent, type Doc, type Fields, type Vault,
} from './lib'

type Page = 'today' | 'project' | 'notes' | 'calendar' | 'board' | 'gantt' | 'projects' | 'agents' | 'guide'
const NAV: [Page, string, LucideIcon][] = [
  ['today', 'My day', Sun], ['notes', 'Notes', NotebookPen], ['calendar', 'Calendar', CalendarDays], ['board', 'Board', KanbanSquare],
  ['gantt', 'Timeline', GanttChart], ['projects', 'Projects', FolderKanban], ['agents', 'Agents', Bot], ['guide', 'Guide', HelpCircle],
]

// Routes live in the URL hash (#notes/inbox%2Fx.md, #project/portal) so back/forward and reloads work.
const parseHash = (): { page: Page; arg: string } => {
  const [page, ...rest] = location.hash.slice(1).split('/')
  return { page: (page === 'terminals' ? 'agents' : NAV.some(([p]) => p === page) || page === 'project' ? page : 'today') as Page, arg: decodeURIComponent(rest.join('/')) }
}

export default function App() {
  const [vault, setVault] = useState<Vault>()
  const [agents, setAgents] = useState<Agent[]>([])
  const [sync, setSync] = useState<Record<string, string>>({})
  const [route, setRoute] = useState(parseHash)
  const [context, setContextState] = useState<string>(() => loadLocal('sb.context', ''))
  const setContext = (c: string) => { setContextState(c); saveLocal('sb.context', c) }
  const [asking, setAsking] = useState(false)
  // What's open in the side peek; the last item is shown, Back pops it.
  const [peeks, setPeeks] = useState<PeekItem[]>([])
  const [wide, setWide] = useState<boolean>(() => loadLocal('sb.peekWide', false))
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
  // Everything a page lists comes from `scoped`; `vault` stays whole for looking things up by name.
  const scoped = scopeVault(vault, context)
  const { page, arg } = route
  // A "needs you" that was marked seen shows as idle until the session changes again.
  const shown = agents.filter((a) => inContext(context, contextOf(a, vault)))
    .map((a) => (a.state === 'needs-input' && seen[a.id] === a.updated ? { ...a, state: 'idle' } : a))
  const markSeen = (a: Agent) => { const next = { ...seen, [a.id]: a.updated }; setSeen(next); saveLocal('sb.seen', next) }
  const project = page === 'project' ? projects[arg] : undefined
  const peek = (p: PeekItem) => setPeeks((st) => (st.at(-1)?.kind === p.kind && st.at(-1)?.id === p.id ? st : [...st.slice(-9), p]))
  // A new task is created right away as "Untitled" and opened, so you can just start typing.
  const openTask = (doc?: Doc) => (doc
    ? peek({ kind: 'task', id: doc.name })
    : api('tasks', 'POST', { data: { title: 'Untitled', project: peeks.at(-1)?.kind === 'project' ? `[[${peeks.at(-1)!.id}]]` : '' } })
      .then(({ id }) => peek({ kind: 'task', id }), fail))
  const write = (path: string) => (path.startsWith('tasks/') ? peek({ kind: 'task', id: path.slice(6, -3) }) : peek({ kind: 'doc', id: path }))
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => flash(`${what} copied`), fail)
  const copyStart = (t: Doc) => copy(startCommand(t, projects[unlink(t.data.project)], vault.root), 'Start command')
  const prep = (title: string, date: string, prefix = 'Prep: ') => {
    const p = guessProject(title, vault.projects)
    api('tasks', 'POST', { data: { title: `${prefix}${title}`, project: p ? `[[${p}]]` : '', type: 'meeting', priority: 'p1', due: date } })
      .then(({ id }) => flash(`${id} created: Prep: ${title}`), fail)
  }
  const meetingNote = (title: string, date: string, time = '') =>
    api('meetings', 'POST', { title, date, time, project: guessProject(title, vault.projects) }).then(({ path }) => write(path), fail)
  const terminal = (body: Record<string, string>) => api('terminals', 'POST', body).then(({ id }) => peek({ kind: 'terminal', id }), fail)
  // Resuming a session that is still working elsewhere would put two windows on one session.
  const openAgent = (a: Agent) => {
    if (a.state === 'working' && !confirm('This session is still working in another window. Open it here anyway?')) return
    terminal({ kind: 'resume', agent: a.id })
  }
  const toggleFocus = (t: Doc) => {
    if (!isFocus(t) && vault.tasks.filter(isFocus).length >= FOCUS_MAX) return flash(`Top ${FOCUS_MAX} is full: unstar one first`)
    api(`tasks/${t.name}`, 'PUT', { data: { focus: !isFocus(t) } }).catch(fail)
  }
  const act: Actions = {
    open: openTask,
    project: (id) => id && peek({ kind: 'project', id }),
    start: (t) => terminal({ kind: 'claude', task: t.name }),
    focus: toggleFocus,
    done: (t) => api(`tasks/${t.name}`, 'PUT', { data: { status: 'done' } }).catch(fail),
    write,
  }
  const grill = (t: Doc) => { setSeed({ task: t.name, message: 'Grill', at: Date.now() }); peek({ kind: 'project', id: unlink(t.data.project) }) }
  const waiting = shown.filter((a) => a.state === 'needs-input').length
  const openCount = (p: Doc) => vault.tasks.filter((t) => unlink(t.data.project) === p.name && t.data.status !== 'done').length

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Second Brain</div>
        <Search vault={vault} openTask={openTask} write={write} />
        <div className="side-actions">
          <IconButton icon={Plus} label="Task" showLabel primary onClick={() => openTask()} />
          <IconButton icon={Plus} label="Note" showLabel onClick={() => api('notes', 'POST', { title: '' }).then(({ path }) => go('notes', path), fail)} />
        </div>
        <nav className="side-nav">
          {NAV.map(([id, label, Icon]) => (
            <button key={id} className={page === id ? 'nav on' : 'nav'} aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}>
              <Icon size={16} strokeWidth={1.8} className="nav-icon" aria-hidden />{label}
              {id === 'agents' && waiting > 0 && <span className="badge" title="Agents waiting for you">{waiting}</span>}
            </button>
          ))}
        </nav>

        <div className="side-section">Projects <IconButton icon={Plus} label="New project" onClick={() => setEditing({ kind: 'project' })} /></div>
        <nav className="side-projects">
          {scoped.projects.filter((p) => p.data.status !== 'done').map((p) => (
            <button key={p.name} className={peeks.at(-1)?.kind === 'project' && peeks.at(-1)?.id === p.name ? 'nav on' : 'nav'} onClick={() => peek({ kind: 'project', id: p.name })}>
              <span className={`dot ${p.data.context}`} />
              <span className="proj-name">{p.data.name ?? p.name}</span>
              {openCount(p) > 0 && <span className="count">{openCount(p)}</span>}
            </button>
          ))}
        </nav>

        <div className="side-foot">
          <span title={sync.error || ''}>Notion: {sync.notion || '…'}</span>
          <IconButton icon={RefreshCw} label="Sync Notion and GitHub now" onClick={() => api('sync', 'POST').then(setSync, fail)} />
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="segmented" role="group" aria-label="Context">
            {['', ...CONTEXTS].map((c) => (
              <button key={c || 'all'} className={context === c ? 'on' : ''} aria-pressed={context === c} onClick={() => setContext(c)}>
                {c && <span className={`dot ${c}`} />}{c ? CONTEXT_LABEL[c] : 'All'}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <IconButton icon={Sparkles} label="Ask" showLabel active={asking} onClick={() => setAsking(!asking)} />
        </div>
        {page === 'today' && <Today vault={scoped} tasks={scoped.tasks} agents={shown} act={act} openAgent={openAgent} seen={markSeen} fail={fail} prep={prep} meetingNote={meetingNote} />}
        {page === 'project' && project && <ProjectPage vault={vault} project={project} terminal={() => terminal({ kind: 'claude', project: project.name })} start={act.start} open={openTask} edit={(doc) => setEditing({ kind: 'project', doc })} fail={fail} seed={seed} write={write} />}
        {page === 'project' && !project && <div className="empty">Unknown project "{arg}".</div>}
        {page === 'notes' && <Notes vault={vault} projects={scoped.projects} path={arg || undefined} go={write} fail={fail} flash={flash} />}
        {page === 'calendar' && <Calendar vault={scoped} tasks={scoped.tasks} open={openTask} write={write} prep={prep} meetingNote={meetingNote} fail={fail} />}
        {page === 'board' && <Board tasks={scoped.tasks.filter((t) => !prios.length || prios.includes(t.data.priority))} setVault={setVault} vault={vault} projects={projects} fail={fail} act={act}
          header={<div className="prio-filter" role="group" aria-label="Priority filter">
            {PRIORITIES.map((p) => (
              <button key={p} className={`prio-chip ${p} ${prios.includes(p) ? 'on' : ''}`} aria-pressed={prios.includes(p)}
                onClick={() => setPrios(prios.includes(p) ? prios.filter((x) => x !== p) : [...prios, p])}>{PRIO_LABEL[p]}</button>
            ))}
          </div>} />}
        {page === 'gantt' && <Gantt tasks={scoped.tasks} projects={projects} open={openTask} fail={fail} />}
        {page === 'projects' && <Projects vault={scoped} go={(p) => peek({ kind: 'project', id: p })} edit={(doc) => setEditing({ kind: 'project', doc })} />}
        {page === 'agents' && (
          <Split id="agents" sideLeft>
            <Terminals active={arg || undefined} go={(id) => go('agents', id)} fail={fail} show={(t) => inContext(context, contextOf(t, vault))} />
            <Agents agents={shown} vault={scoped} open={openAgent} seen={markSeen} act={act} start={terminal} />
          </Split>
        )}
        {page === 'guide' && <Guide />}
      </div>

      {editing?.kind === 'project' && <ProjectPanel key={editing.doc?.name ?? 'new'} doc={editing.doc}
        close={() => setEditing(undefined)} fail={fail} />}
      {peeks.length > 0 && (() => {
        const top = peeks.at(-1)!
        const close = () => setPeeks([])
        const back = peeks.length > 1 ? () => setPeeks(peeks.slice(0, -1)) : undefined
        const setW = (w: boolean) => { setWide(w); saveLocal('sb.peekWide', w) }
        const task = top.kind === 'task' ? vault.tasks.find((t) => t.name === top.id) : undefined
        const proj = top.kind === 'project' ? projects[top.id] : undefined
        const title = task ? <><span className="muted">{unlink(task.data.project) && (projects[unlink(task.data.project)]?.data.name ?? unlink(task.data.project))}</span> {task.name}</>
          : proj ? 'Project' : top.kind === 'terminal' ? 'Agent' : top.id.split('/')[0]
        return (
          <Peek key={`${top.kind}:${top.id}`} title={title} back={back} close={close} wide={wide} setWide={setW}>
            {top.kind === 'task' && (task
              ? <TaskPage task={task} vault={vault} projects={scoped.projects} act={act} agents={agents} openAgent={openAgent} peek={peek} grill={grill} copyStart={copyStart} fail={fail} flash={flash} />
              : <p className="muted">Loading {top.id}…</p>)}
            {top.kind === 'project' && (proj
              ? <ProjectPage compact vault={vault} project={proj} terminal={() => terminal({ kind: 'claude', project: proj.name })} start={act.start} open={openTask}
                  edit={(doc) => setEditing({ kind: 'project', doc })} fail={fail} seed={seed} write={write} />
              : <p className="muted">Unknown project {top.id}.</p>)}
            {top.kind === 'terminal' && <TerminalPeek id={top.id} fail={fail} closed={back ?? close} />}
            {top.kind === 'doc' && <Editor vault={vault} projects={scoped.projects} path={top.id} fail={fail} flash={flash} onFiled={() => {}} />}
          </Peek>
        )
      })()}
      {asking && (
        <aside className="drawer" aria-label="Assistant">
          <span className="drawer-close"><IconButton icon={X} label="Close the assistant" onClick={() => setAsking(false)} /></span>
          <Chat clearTask={() => {}} />
        </aside>
      )}
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

function Board({ tasks, vault, setVault, projects, fail, act, header }: {
  tasks: Doc[]; vault: Vault; setVault: (v: Vault) => void; projects: Record<string, Doc>
  fail: (e: Error) => void; act: Actions; header: React.ReactNode
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [active, setActive] = useState<Doc>()
  const columns = useMemo(() => {
    const cols: Record<string, Doc[]> = Object.fromEntries(STATUSES.map((s) => [s, []]))
    for (const t of tasks) (cols[columnOf(t)] ??= []).push(t)
    // Your top 3 sit at the top of their column.
    for (const c of Object.values(cols)) c.sort((a, b) => Number(isFocus(b)) - Number(isFocus(a)) || byOrder(a, b))
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
      <main className="board-page">
        <div className="page-head"><h2>Board</h2><span className="muted">★ = your top 3</span><div className="spacer" />{header}</div>
        <div className="board">
          {cols.map((s) => (
            <Column key={s} status={s} tasks={columns[s]}>
              {columns[s].map((t) => <SortableCard key={t.name} task={t} project={projects[unlink(t.data.project)]} act={act} />)}
            </Column>
          ))}
        </div>
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

function SortableCard(props: { task: Doc; project?: Doc; act: Actions }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.name })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes} {...listeners} onClick={() => props.act.open(props.task)}>
      <Card {...props} />
    </div>
  )
}

function Card({ task, project, act }: { task: Doc; project?: Doc; act?: Actions }) {
  const d = task.data
  // Buttons inside a draggable card must not start a drag or open the card.
  const stop = (fn: () => void) => ({ onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: (e: React.MouseEvent) => { e.stopPropagation(); fn() } })
  return (
    <article className={`card ${isFocus(task) ? 'focus' : ''}`}>
      <div className="card-top">
        <span className={`prio ${d.priority}`}>{prioLabel(d.priority)}</span>
        <button className="link-plain project" title="Open project" {...stop(() => act?.project(unlink(d.project)))}>{project?.data.name ?? (unlink(d.project) || 'No project')}</button>
        <span className="id">{task.name}</span>
        {act && <span className={`star ${isFocus(task) ? 'on' : ''}`}><IconButton icon={Star} label={isFocus(task) ? 'Remove from top 3' : 'Add to top 3'} active={isFocus(task)} stop onClick={() => act.focus(task)} /></span>}
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
        {act && <span className="hover-actions"><IconButton icon={Play} label="Start an agent on this task" stop onClick={() => act.start(task)} /></span>}
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
              <IconButton icon={Pencil} label="Edit project" stop onClick={() => edit(p)} />
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
            <IconButton icon={X} label="Close" onClick={close} />
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
