import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { marked } from 'marked'
import {
  Bot, CalendarDays, ChevronRight, FolderKanban, GanttChart, HelpCircle, KanbanSquare, Lightbulb, Pencil, Plus, RefreshCw,
  Mountain, Plug, Sparkles, Sun, Waypoints, X, type LucideIcon,
} from 'lucide-react'
import BoardColumns from './Board'
import BrainTerrain from './BrainTerrain'
import type { GraphNode } from './graph'
import { Peek, TaskPage, TerminalPeek, type PeekItem } from './Peek'
import { Dictate, Editor, plantThought } from './Notes'
import { SymbolDefs } from './symbols'
import { IconButton, ModeSwitch } from './ui'
import { THEME_LABEL, useMode, useTheme } from './theme'
import Calendar, { guessProject } from './Calendar'
import Deps, { ViewSwitch, type Graph } from './Deps'
import Gantt from './Gantt'
import Integrations from './Integrations'
import ProjectPage, { Chat, load as loadLocal, save as saveLocal, type Seed } from './Home'
import Notes from './Notes'
import Split from './Split'
import Terminals, { type Term } from './Terminals'
import Today, { Agents, type Actions } from './Today'
import { place, step, type Place } from './combobox'

import {
  CONTEXTS, CONTEXT_LABEL, FOCUS_MAX, LABELS, PRIORITIES, PRIO_LABEL, STATUSES, api, isFocus, list,
  TAB, contextOf, inContext, loader, matchesTask, obsidian, projectOf, scopeVault, startCommand, tabsOf, teachPrompt, unlink,
  type Agent, type Doc, type Fields, type Vault,
} from './lib'

type Page = 'today' | 'notes' | 'calendar' | 'board' | 'gantt' | 'terrain' | 'agents' | 'projects' | 'integrations' | 'guide'
// The views in the side menu. Projects (overview), Integrations and Guide live elsewhere in the menu.
const VIEWS: [Page, string, LucideIcon][] = [
  ['today', 'My day', Sun], ['board', 'Board', KanbanSquare], ['calendar', 'Calendar', CalendarDays],
  ['gantt', 'Timeline', GanttChart], ['notes', 'Thoughts', Lightbulb], ['terrain', 'Brain Terrain', Waypoints], ['agents', 'Agents', Bot],
]
// Pages with their own pane for a kind of item: opening one there shows it in the page, not in the peek.
// Notes only lists notes and meeting notes; other docs (a project file from search) still peek.
const PANE: Partial<Record<PeekItem['kind'], Page>> = { doc: 'notes', terminal: 'agents' }
const inPane = (p: PeekItem, page: Page) => PANE[p.kind] === page && (p.kind !== 'doc' || /^(inbox|notes|meetings)\//.test(p.id))
const PAGE: Record<Page, [string, LucideIcon]> = {
  ...Object.fromEntries(VIEWS.map(([p, l, i]) => [p, [l, i]])) as Record<Page, [string, LucideIcon]>,
  projects: ['Projects', FolderKanban], integrations: ['Integrations', Plug], guide: ['Guide', HelpCircle],
}

// Routes live in the URL hash (#notes/inbox%2Fx.md, #agents/<terminal>) so back/forward and reloads work.
const parseHash = (): { page: Page; arg: string } => {
  const [page, ...rest] = location.hash.slice(1).split('/')
  const p = page === 'terminals' ? 'agents' : page
  return { page: (p in PAGE ? p : 'today') as Page, arg: decodeURIComponent(rest.join('/')) }
}

export default function App() {
  const [vault, setVault] = useState<Vault>()
  const [agents, setAgents] = useState<Agent[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [sync, setSync] = useState<Record<string, string>>({})
  const [route, setRoute] = useState(parseHash)
  const [context, setContextState] = useState<string>(() => loadLocal('sb.context', ''))
  // The project you're "in": every view shows only its tasks. Empty = all projects (in the context).
  const [scope, setScopeState] = useState<string>(() => loadLocal('sb.scope', ''))
  const [asking, setAsking] = useState(false)
  // What's open in the side peek; the last item is shown, Back pops it.
  const [peeks, setPeeks] = useState<PeekItem[]>([])
  const [wide, setWide] = useState<boolean>(() => loadLocal('sb.peekWide', false))
  const [prios, setPrios] = useState<string[]>([])
  // My day's search above the board: narrows its cards.
  const [dayQuery, setDayQuery] = useState('')
  // Board and My day share it, so a card's dependencies button shows the chain right where you are.
  const [graph, setGraph] = useState<Graph>()
  const [editing, setEditing] = useState<{ kind: 'task' | 'project'; doc?: Doc }>()
  const [seed, setSeed] = useState<Seed>()
  const [seen, setSeen] = useState<Record<string, string>>(() => loadLocal('sb.seen', {}))
  const [toast, setToast] = useState('')
  const [capturing, setCapturing] = useState(false)
  // The thought you just captured: its peek asks the agent for a proposal straight away.
  const [captured, setCaptured] = useState('')
  const [theme, nextTheme] = useTheme()
  const [mode, setMode] = useMode()

  const [vaultLoader] = useState(() => loader<Vault>(() => api('data'), setVault))
  const load = useCallback(() => vaultLoader.load(), [vaultLoader])
  const loadAgents = useCallback(() => api('agents').then(setAgents), [])
  const loadTerms = useCallback(() => api('terminals').then(setTerms), [])
  useEffect(() => {
    load()
    loadAgents()
    api('sync').then(setSync)
    let vaultTimer: number
    let agentsTimer: number
    // A drop in this tab already shows, and a reload can't undo it (see loader): its own echo needs none.
    const onChange = (e?: { tab?: string }) => { if (e?.tab === TAB) return; clearTimeout(vaultTimer); vaultTimer = window.setTimeout(load, 100) }
    const onAgents = () => { clearTimeout(agentsTimer); agentsTimer = window.setTimeout(() => { loadAgents(); loadTerms().catch(() => {}) }, 300) }
    // Switching view closes the peek: it belonged to the page you left.
    const onHash = () => { setRoute(parseHash()); setPeeks([]) }
    import.meta.hot?.on('vault-change', onChange)
    import.meta.hot?.on('agents-change', onAgents)
    window.addEventListener('hashchange', onHash)
    // Quick capture works from anywhere, also while typing in an editor.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyK') { e.preventDefault(); setCapturing(true) }
    }
    window.addEventListener('keydown', onKey)
    const poll = window.setInterval(() => { loadAgents(); loadTerms().catch(() => {}); api('sync').then(setSync) }, 60_000)
    return () => {
      import.meta.hot?.off('vault-change', onChange)
      import.meta.hot?.off('agents-change', onAgents)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('keydown', onKey)
      clearInterval(poll)
    }
  }, [load, loadAgents, loadTerms])
  // Tabs open and close by navigating (opening one routes to it), so the route is when to look again.
  useEffect(() => { loadTerms().catch(() => {}) }, [route, peeks.length, loadTerms])

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }
  const fail = (e: Error) => flash(e.message)
  const go = (page: Page, arg = '') => { location.hash = arg ? `${page}/${encodeURIComponent(arg)}` : page }

  if (!vault) return <div className="empty">Loading vault…</div>
  const projects = Object.fromEntries(vault.projects.map((p) => [p.name, p]))
  const scopeProject = scope ? projects[scope] : undefined
  const setContext = (c: string) => {
    setContextState(c); saveLocal('sb.context', c)
    if (scopeProject && !inContext(c, scopeProject.data.context)) { setScopeState(''); saveLocal('sb.scope', '') }
  }
  const setScope = (name: string) => {
    setScopeState(name); saveLocal('sb.scope', name); setPeeks([])
    // Picking a project outside the current context widens the context, so the project stays visible.
    if (name && !inContext(context, projects[name]?.data.context)) { setContextState(''); saveLocal('sb.context', '') }
  }
  // `scoped` is the context; `view` narrows it to the project you're in. `vault` stays whole for lookups by name.
  const scoped = scopeVault(vault, context)
  const inScope = (d: Doc) => !scopeProject || unlink(d.data.project) === scope
  const view: Vault = scopeProject ? { ...scoped, tasks: scoped.tasks.filter(inScope), meetings: scoped.meetings.filter(inScope) } : scoped
  const { page, arg } = route
  // A "needs you" that was marked seen shows as idle until the session changes again.
  const unseen = agents.map((a) => (a.state === 'needs-input' && seen[a.id] === a.updated ? { ...a, state: 'idle' } : a))
  const shown = unseen.filter((a) => inContext(context, contextOf(a, vault)) && (!scope || projectOf(a, vault)?.name === scope))
  const markSeen = (a: Agent) => { const next = { ...seen, [a.id]: a.updated }; setSeen(next); saveLocal('sb.seen', next) }
  const peek = (p: PeekItem) => (inPane(p, page) ? go(page, p.id)
    : setPeeks((st) => (st.at(-1)?.kind === p.kind && st.at(-1)?.id === p.id ? st : [...st.slice(-9), p])))
  // A new task is created right away as "Untitled" and opened, so you can just start typing.
  const openTask = (doc?: Doc) => {
    if (doc) return peek({ kind: 'task', id: doc.name })
    const inProject = peeks.at(-1)?.kind === 'project' ? peeks.at(-1)!.id : scope
    api('tasks', 'POST', { data: { title: 'Untitled', project: inProject ? `[[${inProject}]]` : '' } }).then(({ id }) => peek({ kind: 'task', id }), fail)
  }
  const write = (path: string) => (path.startsWith('tasks/') ? peek({ kind: 'task', id: path.slice(6, -3) }) : peek({ kind: 'doc', id: path }))
  // A thought you just captured opens, and asks the agent where it belongs.
  const planted = (path: string) => { setCaptured(path); flash('Thought saved'); write(path) }
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => flash(`${what} copied`), fail)
  const copyStart = (t: Doc) => copy(startCommand(t, projects[unlink(t.data.project)], vault.root), 'Start command')
  const prep = (title: string, date: string, prefix = 'Prep: ') => {
    const p = scope || guessProject(title, vault.projects)
    api('tasks', 'POST', { data: { title: `${prefix}${title}`, project: p ? `[[${p}]]` : '', type: 'meeting', priority: 'p1', due: date } })
      .then(({ id }) => flash(`${id} created: Prep: ${title}`), fail)
  }
  const meetingNote = (title: string, date: string, time = '') =>
    api('meetings', 'POST', { title, date, time, project: scope || guessProject(title, vault.projects) }).then(({ path }) => write(path), fail)
  const terminal = (body: Record<string, string>) => api('terminals', 'POST', body).then(({ id }) => peek({ kind: 'terminal', id }), fail)
  // A session with an open tab goes to that tab. Resuming one that is still working elsewhere would put two windows on one session.
  const tabs = tabsOf(agents, terms)
  const openAgent = (a: Agent) => {
    const tab = tabs.get(a.id)
    if (tab) return peek({ kind: 'terminal', id: tab })
    if (a.state === 'working' && !confirm('This session is still working in another window. Open it here anyway?')) return
    terminal({ kind: 'resume', agent: a.id })
  }
  const toggleFocus = (t: Doc) => {
    if (!isFocus(t) && vault.tasks.filter(isFocus).length >= FOCUS_MAX) return flash(`You can pin ${FOCUS_MAX}: unpin one first`)
    api(`tasks/${t.name}`, 'PUT', { data: { focus: !isFocus(t) } }).catch(fail)
  }
  const act: Actions = {
    open: openTask,
    project: (id) => id && peek({ kind: 'project', id }),
    start: (t) => terminal({ kind: 'claude', task: t.name }),
    autopilot: (t) => terminal({ kind: 'autopilot', task: t.name }),
    focus: toggleFocus,
    done: (t) => api(`tasks/${t.name}`, 'PUT', { data: { status: 'done' } }).catch(fail),
    deps: (t) => setGraph({ focus: t.name }),
    agent: openAgent,
    write,
  }
  // A graph node: projects open their overview, teach reports their HTML in a new tab, a learning folder
  // its mission in Obsidian, the rest in the peek.
  const openNode = (n: GraphNode) => {
    if (n.kind === 'project') act.project(n.name)
    else if (n.kind === 'report') window.open(`/api/reports/${n.name}`, '_blank', 'noopener')
    else if (n.kind === 'lake') { if (n.status === 'mission') location.href = obsidian(`${vault.vault}/${n.id}/MISSION.md`); else flash(`${n.title} has no MISSION.md yet`) }
    else write(n.id)
  }
  const grill = (t: Doc) => { setSeed({ task: t.name, message: 'Grill', at: Date.now() }); peek({ kind: 'project', id: unlink(t.data.project) }) }
  const teach = (t: Doc) => { setSeed({ task: t.name, message: teachPrompt(t, vault.vault), at: Date.now() }); peek({ kind: 'project', id: unlink(t.data.project) }) }
  const waiting = shown.filter((a) => a.state === 'needs-input').length
  const openCount = (p: Doc) => vault.tasks.filter((t) => unlink(t.data.project) === p.name && t.data.status !== 'done').length
  // The menu lists the projects you work on in this context; a finished one only while you're in it.
  const sideProjects = scoped.projects.filter((p) => p.data.status !== 'done' || p.name === scope)
    .sort((a, b) => String(a.data.name ?? a.name).localeCompare(String(b.data.name ?? b.name)))
  const [pageLabel, PageIcon] = PAGE[page]
  const filtered = view.tasks.filter((t) => !prios.length || prios.includes(t.data.priority))
  const dayTasks = view.tasks.filter((t) => matchesTask(t, dayQuery.trim(), projects))
  const deps = <Deps tasks={view.tasks} all={vault.tasks} focus={graph?.focus} agents={agents} open={openTask} showAll={() => setGraph({})} compact={page === 'today'} />

  return (
    <div className="app">
      <SymbolDefs />
      <aside className="sidebar">
        <div className="brand">Brain Terrain</div>
        {/* Like a workspace switcher: the context filters everything below it. */}
        <div className="context-switch" role="group" aria-label="Context">
          {['', ...CONTEXTS].map((c) => (
            <button key={c || 'all'} className={context === c ? 'on' : ''} aria-pressed={context === c} onClick={() => setContext(c)}>
              {c ? CONTEXT_LABEL[c] : 'All'}
            </button>
          ))}
        </div>
        <Search vault={vault} openTask={openTask} write={write} />
        <div className="side-actions">
          <IconButton icon={Plus} label="Task" showLabel primary onClick={() => openTask()} />
          <IconButton icon={Lightbulb} label="Thought" showLabel onClick={() => setCapturing(true)} />
        </div>
        <nav className="side-nav" aria-label="Views">
          {VIEWS.map(([id, label, Icon]) => (
            <button key={id} className={page === id ? 'nav on' : 'nav'} aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}>
              <Icon size={16} strokeWidth={1.8} className="nav-icon" aria-hidden />{label}
              {id === 'agents' && waiting > 0 && <span className="badge" title="Agents waiting for you">{waiting}</span>}
            </button>
          ))}
        </nav>

        <div className="side-section">
          <button className={`side-section-link ${page === 'projects' ? 'on' : ''}`} onClick={() => go('projects')} title="All projects as cards">Projects</button>
          <IconButton icon={Plus} label="New project" onClick={() => setEditing({ kind: 'project' })} />
        </div>
        {/* Picking a project scopes every view to it; picking it again shows all projects. */}
        <nav className="side-projects" aria-label="Projects">
          {sideProjects.map((p) => (
            <button key={p.name} className={scope === p.name ? 'nav on' : 'nav'} aria-pressed={scope === p.name} title={scope === p.name ? 'Show all projects again' : 'Show only this project in every view'}
              onClick={() => setScope(scope === p.name ? '' : p.name)}>
              <span className={`dot ${p.data.context ?? ''}`} />
              <span className="proj-name">{p.data.name ?? p.name}</span>
              {openCount(p) > 0 && <span className="side-count">{openCount(p)}</span>}
            </button>
          ))}
        </nav>

        <div className="side-foot">
          <button className={`nav ${page === 'integrations' ? 'on' : ''}`} onClick={() => go('integrations')}><Plug size={16} strokeWidth={1.8} className="nav-icon" aria-hidden />Integrations</button>
          <button className={`nav ${page === 'guide' ? 'on' : ''}`} onClick={() => go('guide')}><HelpCircle size={16} strokeWidth={1.8} className="nav-icon" aria-hidden />Guide</button>
          <div className="sync-line">
            <button className="link-plain sync-state" title={[sync.notion, sync.error].filter(Boolean).join('\n')} onClick={() => go('integrations')}>
              <span className={`dot ${sync.notion === 'ok' ? 'filed' : sync.notion === 'error' ? 'inbox' : ''}`} />Notion {sync.notion ? sync.notion.split(':')[0] : '…'}
            </button>
            <IconButton icon={RefreshCw} label="Sync Notion and GitHub now" onClick={() => api('sync', 'POST').then(setSync, fail)} />
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <nav className="crumbs" aria-label="You are here">
            <span className="crumb"><PageIcon size={18} strokeWidth={1.8} aria-hidden /><h1>{pageLabel}</h1></span>
            {scopeProject && !['projects', 'integrations', 'guide'].includes(page) && <>
              <ChevronRight size={16} className="crumb-sep" aria-hidden />
              <span className="crumb project-crumb">
                <span className={`dot ${scopeProject.data.context ?? ''}`} />
                <button className="link-plain project-crumb-name" onClick={() => peek({ kind: 'project', id: scope })} title="Project overview: tasks, chat, new agent">{scopeProject.data.name ?? scope}</button>
                <IconButton icon={X} label="Show all projects" onClick={() => setScope('')} />
              </span>
            </>}
          </nav>
          <div className="spacer" />
          <ModeSwitch mode={mode} set={setMode} />
          <IconButton icon={Mountain} label={`Theme: ${THEME_LABEL[theme]}. Click to switch`} active={theme === 'terrain'} onClick={nextTheme} />
          <IconButton icon={Sparkles} label="Ask Claude" showLabel active={asking} onClick={() => setAsking(!asking)} />
        </header>
        {page === 'today' && <Today vault={view} tasks={view.tasks} act={act} fail={fail} prep={prep} meetingNote={meetingNote}
          board={<><div className="board-tools"><ViewSwitch graph={graph} set={setGraph} />
            {!graph && <div className="search"><input type="search" value={dayQuery} placeholder="Find a card…" aria-label="Find a card on your board" onChange={(e) => setDayQuery(e.target.value)} /></div>}</div>
            {graph ? deps
            : <BoardColumns tasks={dayTasks} vault={vault} agents={shown} drop={vaultLoader.dropped} fail={fail} act={act} statuses={['todo', 'wip', 'review', 'blocked', 'done']} limit={6} more={() => go('board')} />}</>} />}
        {page === 'notes' && <Notes vault={vault} projects={scoped.projects} path={arg || undefined} go={write} captured={captured} asked={() => setCaptured('')} planted={planted} fail={fail} flash={flash} />}
        {page === 'calendar' && <Calendar vault={view} tasks={view.tasks} open={openTask} write={write} prep={prep} meetingNote={meetingNote} fail={fail} />}
        {page === 'board' && (
          <main className="board-page">
            <div className="filter-bar">
              <span className="muted">Priority</span>
              <div className="prio-filter" role="group" aria-label="Priority filter">
                {PRIORITIES.map((p) => (
                  <button key={p} className={`prio-chip ${p} ${prios.includes(p) ? 'on' : ''}`} aria-pressed={prios.includes(p)}
                    onClick={() => setPrios(prios.includes(p) ? prios.filter((x) => x !== p) : [...prios, p])}>{PRIO_LABEL[p]}</button>
                ))}
              </div>
              <span className="muted">{filtered.filter((t) => t.data.status !== 'done').length} open · pinned cards stay on top · drag to change status</span>
              <span className="spacer" />
              <ViewSwitch graph={graph} set={setGraph} />
            </div>
            {graph ? deps : <BoardColumns tasks={filtered} vault={vault} agents={shown} drop={vaultLoader.dropped} fail={fail} act={act} />}
          </main>
        )}
        {page === 'gantt' && <Gantt tasks={view.tasks} projects={projects} open={openTask} fail={fail} />}
        {page === 'terrain' && <BrainTerrain vault={vault} context={context} scope={scope} agents={unseen} open={openNode} fail={fail} />}
        {page === 'projects' && <Projects vault={scoped} go={(p) => peek({ kind: 'project', id: p })} edit={(doc) => setEditing({ kind: 'project', doc })} />}
        {page === 'agents' && (
          <Split id="agents" sideLeft>
            <Terminals all={terms} refresh={loadTerms} active={arg || undefined} go={(id) => go('agents', id)} fail={fail} show={(t) => inContext(context, contextOf(t, vault))} />
            <Agents agents={shown} vault={view} tabs={tabs} active={arg} open={openAgent} seen={markSeen} act={act} start={terminal} />
          </Split>
        )}
        {page === 'integrations' && <Integrations synced={setSync} fail={fail} />}
        {page === 'guide' && <Guide />}
      </div>

      {capturing && <Capture close={() => setCapturing(false)} fail={fail}
        saved={(path) => { setCapturing(false); planted(path) }} />}
      {editing?.kind === 'project' && <ProjectPanel key={editing.doc?.name ?? 'new'} doc={editing.doc}
        close={() => setEditing(undefined)} fail={fail} />}
      {peeks.length > 0 && (() => {
        const top = peeks.at(-1)!
        const close = () => { setPeeks([]); setCaptured('') }
        const back = peeks.length > 1 ? () => setPeeks(peeks.slice(0, -1)) : undefined
        const setW = (w: boolean) => { setWide(w); saveLocal('sb.peekWide', w) }
        const task = top.kind === 'task' ? vault.tasks.find((t) => t.name === top.id) : undefined
        const proj = top.kind === 'project' ? projects[top.id] : undefined
        const title = task ? <><span className="muted">{unlink(task.data.project) && (projects[unlink(task.data.project)]?.data.name ?? unlink(task.data.project))}</span> {task.name}</>
          : proj ? 'Project' : top.kind === 'terminal' ? 'Agent' : top.id.startsWith('meetings/') ? 'Meeting' : /^(inbox|notes)\//.test(top.id) ? 'Thought' : top.id.split('/')[0]
        return (
          <Peek key={`${top.kind}:${top.id}`} title={title} back={back} close={close} wide={wide} setWide={setW}>
            {top.kind === 'task' && (task
              ? <TaskPage task={task} vault={vault} projects={scoped.projects} act={act} agents={agents} openAgent={openAgent} peek={peek} grill={grill} teach={teach} copyStart={copyStart} fail={fail} flash={flash} />
              : <p className="muted">Loading {top.id}…</p>)}
            {top.kind === 'project' && (proj
              ? <ProjectPage compact vault={vault} project={proj} terminal={() => terminal({ kind: 'claude', project: proj.name })} start={act.start} open={openTask}
                  edit={(doc) => setEditing({ kind: 'project', doc })} fail={fail} seed={seed} write={write} />
              : <p className="muted">Unknown project {top.id}.</p>)}
            {top.kind === 'terminal' && <TerminalPeek id={top.id} fail={fail} closed={back ?? close} />}
            {top.kind === 'doc' && <Editor vault={vault} projects={scoped.projects} path={top.id} fail={fail} flash={flash} onFiled={() => {}} autoFile={top.id === captured} />}
          </Peek>
        )
      })()}
      {asking && (
        <aside className="drawer" aria-label="Ask Claude">
          <span className="drawer-close"><IconButton icon={X} label="Close Ask Claude" onClick={() => setAsking(false)} /></span>
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
  const [state, setState] = useState<'loading' | 'done' | 'failed'>('done')
  const [open, setOpenState] = useState(false)
  const [active, setActive] = useState(-1)
  const [at, setAt] = useState<Place>()
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const searching = q.trim().length >= 2
  const loading = state === 'loading'
  const setOpen = (o: boolean) => { setOpenState(o); if (!o) setActive(-1) }
  useEffect(() => {
    setActive(-1)
    if (!searching) { setHits([]); setState('done'); return }
    // A slower answer to an earlier query arrives after this cleanup ran, so it's dropped.
    let live = true
    setState('loading')
    const t = setTimeout(() => api(`search?q=${encodeURIComponent(q)}`)
      .then((h) => { if (live) { setHits(h); setState('done') } }, () => { if (live) { setHits([]); setState('failed') } }), 200)
    return () => { live = false; clearTimeout(t) }
  }, [q, searching])
  const shown = open && searching
  // The dropdown is fixed to the viewport (the sidebar scrolls, so it would clip it): follow the input,
  // and close once the input scrolls out of sight.
  useEffect(() => {
    if (!shown) return
    const follow = (e?: Event) => {
      if (!input.current || (e && e.target instanceof Node && input.current.parentElement?.contains(e.target))) return
      const rect = input.current.getBoundingClientRect()
      if (rect.bottom < 0) return setOpen(false)
      setAt(place(rect, { width: innerWidth, height: innerHeight }))
    }
    follow()
    addEventListener('resize', follow)
    addEventListener('scroll', follow, true)
    return () => { removeEventListener('resize', follow); removeEventListener('scroll', follow, true) }
  }, [shown])
  useEffect(() => { if (active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [active, id])
  const pick = (h: (typeof hits)[number]) => {
    setQ('')
    setOpen(false)
    input.current?.blur()
    const task = h.dir === 'tasks' && vault.tasks.find((t) => t.name === h.name)
    if (task) openTask(task)
    else write(h.path)
  }
  // While a new query loads, the old results stay on screen but can't be picked: they answer another query.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !loading) {
      e.preventDefault()
      setOpenState(true)
      setActive((a) => step(a, e.key === 'ArrowDown' ? 1 : -1, hits.length))
    } else if (e.key === 'Enter' && shown && hits.length && !loading) {
      e.preventDefault()
      pick(hits[Math.max(active, 0)])
    } else if (e.key === 'Escape') {
      // First Escape closes the results, the next one clears the query.
      e.preventDefault()
      if (shown) setOpen(false)
      else setQ('')
    }
  }
  const note = loading ? 'Searching…' : state === 'failed' ? 'Search failed, try again' : hits.length ? '' : `Nothing found for “${q.trim()}”`
  return (
    <div className="search">
      <input ref={input} type="search" value={q} placeholder="Search everything…" aria-label="Search the vault"
        role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={shown ? `${id}-hits` : undefined}
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setOpenState(true) }} onFocus={() => setOpenState(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      {shown && at && (
        // mousedown would blur the input and close the list before the click lands on an option.
        <div className="search-hits" style={{ left: at.left, top: at.top, width: at.width, maxHeight: at.maxHeight }} onMouseDown={(e) => e.preventDefault()}>
          <p className="search-note" role="status">{note}</p>
          <ul id={`${id}-hits`} role="listbox" aria-label="Search results" aria-busy={loading} className={loading ? 'stale' : undefined}>
            {hits.map((h, i) => (
              <li key={h.path} id={`${id}-${i}`} role="option" aria-selected={i === active} onClick={() => !loading && pick(h)} onMouseMove={() => !loading && setActive(i)}>
                <span className="chip">{h.dir === 'inbox' || h.dir === 'notes' ? 'thought' : h.dir}</span> <strong>{h.title}</strong>
                {h.snippet && <div className="muted">…{h.snippet}…</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
              <span className="muted">{CONTEXT_LABEL[p.data.context] ?? p.data.context}</span>
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
              {STATUSES.filter((s) => s !== 'done').map((s) => [s, mine.filter((t) => t.data.status === s).length] as const).filter(([, n]) => n)
                .map(([s, n]) => `${n} ${LABELS[s].toLowerCase()}`).join(' · ') || 'Nothing open'}
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

// Quick capture: the text is saved as-is to the inbox, then it opens so the agent can propose where it goes.
function Capture({ close, saved, fail }: { close: () => void; saved: (path: string) => void; fail: (e: Error) => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  // Saving waits until a dictation is in, so the spoken part is never lost.
  const [dictating, setDictating] = useState(false)
  const save = () => {
    if (dictating) return
    if (!text.trim()) return close()
    if (saving) return
    setSaving(true)
    plantThought(text).then(({ path }) => saved(path), (e) => { setSaving(false); fail(e) })
  }
  return (
    <Panel title="New thought" close={close} onSave={save}>
      <div className="capture">
        <Field label="An idea, a finding, a blog draft: saved as-is, then filed. ⌘↵ saves.">
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save() } }} />
        </Field>
        <Dictate add={(said) => setText((t) => t.trim() ? `${t.trimEnd()}\n${said}` : said)} busy={setDictating} />
      </div>
    </Panel>
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
