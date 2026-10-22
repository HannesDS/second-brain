import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft, Copy, ExternalLink, GitPullRequest, Maximize2, MessagesSquare, Minimize2, NotebookText, Play, Square, Star, TerminalSquare, X,
} from 'lucide-react'
import { ProjectSelect } from './Home'
import { Editor } from './Notes'
import { XTerm, type Term } from './Terminals'
import type { Actions } from './Today'
import { IconButton, IconLink } from './ui'
import { PRIORITIES, PRIO_LABEL, STATUSES, TYPES, api, isFocus, list, obsidian, unlink, type Agent, type Doc, type Vault } from './lib'

export type PeekItem = { kind: 'task' | 'project' | 'terminal' | 'doc'; id: string }

// Side peek, like Notion's: opens over the current page so you never lose your place.
// Back walks the stack of things opened from inside the peek.
export function Peek({ title, children, back, close, wide, setWide }: {
  title: ReactNode; children: ReactNode; back?: () => void; close: () => void; wide: boolean; setWide: (w: boolean) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape inside the editor or a field shouldn't throw away the page you're writing in.
      const el = e.target as HTMLElement
      if (e.key === 'Escape' && !el.closest('input, textarea, select, .milkdown, .xterm')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  return (
    <aside className={`peek ${wide ? 'wide' : ''}`} aria-label="Details">
      <div className="peek-bar">
        {back && <IconButton icon={ArrowLeft} label="Back" onClick={back} />}
        <div className="peek-title">{title}</div>
        <IconButton icon={wide ? Minimize2 : Maximize2} label={wide ? 'Narrower' : 'Wider'} onClick={() => setWide(!wide)} />
        <IconButton icon={X} label="Close" onClick={close} />
      </div>
      <div className="peek-body">{children}</div>
    </aside>
  )
}

// A text field that saves when you leave it (or press Enter), not on every keystroke.
function BlurInput({ value, save, type = 'text', placeholder, className, autoFocus }: {
  value: string; save: (v: string) => void; type?: string; placeholder?: string; className?: string; autoFocus?: boolean
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input className={className} type={type} value={v} placeholder={placeholder} autoFocus={autoFocus}
      onFocus={(e) => autoFocus && e.target.select()}
      onChange={(e) => { setV(e.target.value); if (type === 'date') save(e.target.value) }}
      onBlur={() => type !== 'date' && v !== value && save(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  )
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return <label className="prop"><span>{label}</span>{children}</label>
}

// The task as a page: title, properties that save as you change them, and the body to write in.
export function TaskPage({ task, vault, projects, act, agents, openAgent, peek, grill, copyStart, fail, flash }: {
  task: Doc; vault: Vault; projects: Doc[]; act: Actions; agents: Agent[]; openAgent: (a: Agent) => void
  peek: (p: PeekItem) => void; grill: (t: Doc) => void; copyStart: (t: Doc) => void; fail: (e: Error) => void; flash: (m: string) => void
}) {
  const d = task.data
  const save = (data: Record<string, unknown>) => api(`tasks/${task.name}`, 'PUT', { data }).catch(fail)
  const select = (k: string, opts: string[], labels: Record<string, string> = {}) => (
    <select value={d[k] ?? ''} onChange={(e) => save({ [k]: e.target.value })}>
      {opts.map((o) => <option key={o} value={o}>{labels[o] ?? o}</option>)}
    </select>
  )
  const meetings = [...new Set([
    ...list(d.meetings).map(unlink),
    ...vault.meetings.filter((m) => list(m.data.tasks).map(unlink).includes(task.name)).map((m) => m.name),
  ])]

  return (
    <div className="task-page">
      <div className="page-actions">
        <IconButton icon={Play} label="Start agent" showLabel primary onClick={() => act.start(task)} />
        <IconButton icon={MessagesSquare} label="Grill me" showLabel onClick={() => grill(task)} />
        <IconButton icon={Star} label={isFocus(task) ? 'In top 3' : 'Top 3'} showLabel active={isFocus(task)} onClick={() => act.focus(task)} />
        <div className="spacer" />
        {d.notion && <IconLink icon={ExternalLink} label="Notion" showLabel href={d.notion} />}
        {d.pr && <IconLink icon={GitPullRequest} label={`PR ${String(d.pr).split('/').pop()}`} showLabel href={d.pr} />}
        <IconLink icon={NotebookText} label="Open in Obsidian" href={obsidian(`${vault.vault}/tasks/${task.name}.md`)} />
        <IconButton icon={Copy} label="Copy a start command for your own terminal" onClick={() => copyStart(task)} />
      </div>

      <BlurInput className="page-title" value={d.title ?? ''} save={(title) => title.trim() && save({ title: title.trim() })}
        placeholder="Untitled" autoFocus={d.title === 'Untitled'} />

      <div className="props">
        <Prop label="Project"><ProjectSelect projects={projects} all={vault.projects} value={unlink(d.project)} none="None" onChange={(name) => save({ project: name ? `[[${name}]]` : '' })} /></Prop>
        <Prop label="Status">{select('status', STATUSES)}</Prop>
        <Prop label="Priority">{select('priority', PRIORITIES, PRIO_LABEL)}</Prop>
        <Prop label="Type">{select('type', TYPES)}</Prop>
        <Prop label="Start"><BlurInput type="date" value={d.start ?? ''} save={(v) => save({ start: v })} /></Prop>
        <Prop label="Due"><BlurInput type="date" value={d.due ?? ''} save={(v) => save({ due: v })} /></Prop>
        <Prop label="Blocked by"><BlurInput value={d.blocked_by ?? ''} placeholder="Nothing" save={(v) => save({ blocked_by: v })} /></Prop>
        <Prop label="Notion"><BlurInput type="url" value={d.notion ?? ''} placeholder="Team ticket URL" save={(v) => save({ notion: v })} /></Prop>
        <Prop label="Pull request"><BlurInput type="url" value={d.pr ?? ''} placeholder="PR URL" save={(v) => save({ pr: v })} /></Prop>
        <Prop label="Repo"><BlurInput value={d.repo ?? ''} placeholder="Project's repo" save={(v) => save({ repo: v })} /></Prop>
      </div>

      {(meetings.length > 0 || list(d.sessions).length > 0 || list(d.sources).length > 0) && (
        <div className="link-chips">
          {meetings.map((m) => <button type="button" key={m} className="chip" onClick={() => peek({ kind: 'doc', id: `meetings/${m}.md` })}><NotebookText size={13} aria-hidden /> {m}</button>)}
          {list(d.sessions).map((x) => {
            const a = agents.find((g) => g.id === x)
            return a
              ? <button type="button" key={x} className="chip" onClick={() => openAgent(a)}><TerminalSquare size={13} aria-hidden /> session {x.slice(0, 8)} · {a.state}</button>
              : <span key={x} className="chip muted" title={`${x}: older than 3 days`}>session {x.slice(0, 8)}</span>
          })}
          {list(d.sources).filter((x) => x !== d.pr && x !== d.notion).map((x) => /^https?:/.test(x)
            ? <a key={x} className="chip" href={x} target="_blank" rel="noreferrer">{x.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)} ↗</a>
            : <span key={x} className="chip">{x.replace(/\[|\]/g, '')}</span>)}
        </div>
      )}

      <Editor key={task.name} bare vault={vault} projects={projects} path={`tasks/${task.name}.md`} fail={fail} flash={flash} onFiled={() => {}} />
    </div>
  )
}

// An agent terminal inside the peek; it keeps running when you close the peek.
export function TerminalPeek({ id, fail, closed }: { id: string; fail: (e: Error) => void; closed: () => void }) {
  const [term, setTerm] = useState<Term>()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    api('terminals').then((all: Term[]) => mounted.current && setTerm(all.find((t) => t.id === id)), fail)
    return () => { mounted.current = false }
  }, [id])
  if (!term) return <p className="muted">Opening terminal…</p>
  return (
    <div className="terminal-peek">
      <div className="page-actions">
        <span className="muted">{term.cwd} · {term.account} account</span>
        <div className="spacer" />
        <IconLink icon={TerminalSquare} label="All agents and terminals" href={`#agents/${term.id}`} showLabel />
        <IconButton icon={Square} label="Stop this terminal" showLabel onClick={() => api(`terminals/${id}`, 'DELETE').then(closed, fail)} />
      </div>
      <XTerm key={term.id} term={term} />
    </div>
  )
}
