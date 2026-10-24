import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { ChevronDown, ChevronLeft, ChevronUp, Circle, Mic, Search, Square, X } from 'lucide-react'
import '@milkdown/crepe/theme/common/style.css'
import { SPEAKERS, api, debounce, list, noteTitle, prioLabel, unlink, type Doc, type Speaker, type Vault } from './lib'
import { CLEARING, H, W, clearingOf, isMeeting, matchesNote, plantedAt, shortWhen, taskIds, thisWeek, waiting, type Note } from './clearing'
import { BLOB } from './Landscape'
import { MapSymbol } from './symbols'
import { IconButton } from './ui'
import { ProjectSelect, load, save } from './Home'

type Action = Record<string, any> & { kind: string; reason: string }
type Proposal = { summary: string; actions: Action[]; questions?: string[] }
// A captured thought is named after its first line: then the preview would only repeat the title.
const sameStart = (a: string, b: string) => a.slice(0, 24).toLowerCase() === b.slice(0, 24).toLowerCase()
const FILTERS = [['', 'All'], ['waiting', 'Waiting'], ['rooted', 'Rooted'], ['meetings', 'Meetings']] as const
type Filter = typeof FILTERS[number][0]
const shows = (f: Filter, n: Note) => (f === 'meetings' ? isMeeting(n) : f === 'waiting' ? waiting(n) : f === 'rooted' ? !isMeeting(n) && !waiting(n) : true)
const plantedToday = (n: Note) => plantedAt(n).toDateString() === new Date().toDateString()
const symbolOf = (n: Note) => (isMeeting(n) ? 'hut' : waiting(n) ? 'sapling' : 'tree')

// Saved as-is to the inbox, named after its first line.
export const plantThought = (text: string): Promise<{ path: string }> =>
  api('notes', 'POST', { title: text.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 60), body: `${text.trim()}\n` })

// Thoughts and meeting notes: write freely (saved as you type), then let the agent propose where it goes.
// Without one open it's the clearing: unfiled thoughts are saplings, filed ones trees on their project's hill.
export default function Notes({ vault, projects, path, go, captured, asked, planted, fail, flash }: {
  vault: Vault; projects: Doc[]; path?: string; go: (path: string) => void; captured: string; asked: () => void; planted: (path: string) => void
  fail: (e: Error) => void; flash: (m: string) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [filter, setFilter] = useState<Filter>('')
  const [query, setQuery] = useState('')
  // Proposals "Find a place for all" fetched, kept until you open the thought; and where that run is.
  const [ready, setReady] = useState<Record<string, Proposal>>({})
  const [finding, setFinding] = useState<{ path: string; done: number; of: number }>()
  // The thought whose "Find its place" you clicked: it asks the agent as it opens.
  const [findFor, setFindFor] = useState('')
  const refresh = () => api('notes').then(setNotes, fail)
  // The vault changes when a thought is captured or filed elsewhere, so the list follows it.
  useEffect(() => { refresh() }, [path, vault])
  const open = (p: string, find = false) => { setFindFor(find ? p : ''); go(p) }
  const filed = () => { if (path) setReady(({ [path]: _, ...rest }) => rest); refresh() }

  // One after the other: each is a full agent run.
  async function findAll(paths: string[]) {
    for (const [done, p] of paths.entries()) {
      setFinding({ path: p, done, of: paths.length })
      try {
        const proposal = await api('file', 'POST', { path: p, answers: '' })
        setReady((r) => ({ ...r, [p]: proposal }))
      } catch (e) { fail(e as Error) }
    }
    setFinding(undefined)
  }

  if (!path) return <Clearing notes={notes} vault={vault} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} open={open}
    planted={planted} ready={ready} finding={finding} findAll={findAll} fail={fail} />
  const shown = notes.filter((n) => shows(filter, n))
  return (
    <main className="notes">
      <nav className="pane note-list" aria-label="Thoughts">
        <a className="note-back" href="#notes"><ChevronLeft size={14} strokeWidth={1.8} aria-hidden /> The clearing</a>
        <ul className="note-rows">
          {shown.map((n) => (
            <li key={n.path}>
              <button className={n.path === path ? 'note-row on' : 'note-row'} aria-current={n.path === path ? 'true' : undefined} onClick={() => open(n.path)}>
                <MapSymbol id={symbolOf(n)} />
                <span className="note-row-name">{noteTitle(n.name).title}</span>
                <span className="note-when">{shortWhen(n)}</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="muted note-none">Nothing here yet.</li>}
        </ul>
      </nav>
      {/* Remounts when "Find a place for all" brings its proposal while it's open. */}
      <Editor key={`${path}:${!!ready[path]}`} vault={vault} projects={projects} path={path} fail={fail} flash={flash} onFiled={filed}
        proposal={ready[path]} autoFile={!ready[path] && (path === captured || path === findFor)} onAsked={() => { setFindFor(''); asked() }} />
    </main>
  )
}

function Clearing({ notes, vault, filter, setFilter, query, setQuery, open, planted, ready, finding, findAll, fail }: {
  notes: Note[]; vault: Vault; filter: Filter; setFilter: (f: Filter) => void; query: string; setQuery: (q: string) => void
  open: (path: string, find?: boolean) => void; planted: (path: string) => void; ready: Record<string, Proposal>
  finding?: { path: string; done: number; of: number }; findAll: (paths: string[]) => void; fail: (e: Error) => void
}) {
  const search = useRef<HTMLInputElement>(null)
  // "/" jumps to the search, unless you're typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key !== '/' || e.metaKey || e.ctrlKey || t.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      search.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const q = query.trim()
  const hit = (n: Note) => !q || matchesNote(n, q)
  const thoughts = notes.filter((n) => !isMeeting(n))
  const saplings = thoughts.filter(waiting)
  const week = thoughts.filter((n) => thisWeek(n))
  const newest = useMemo(() => clearingOf(notes, vault.tasks).newest, [notes, vault.tasks])
  const cards = saplings.filter(hit)
  // A search reaches back further than this week.
  const rooted = thoughts.filter((n) => !waiting(n) && hit(n) && (q || filter === 'rooted' || thisWeek(n)))
  const meetings = notes.filter((n) => isMeeting(n) && hit(n))
  const hillName = (p: string) => vault.projects.find((x) => x.name === p)?.data.name ?? p
  const n = saplings.length
  const unplaced = saplings.filter((x) => !ready[x.path]).map((x) => x.path)

  return (
    <main className="clearing">
      <header className="clearing-head">
        <div className="clearing-title">
          <span className="label">Thoughts · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1>{n ? `${n} thought${n === 1 ? '' : 's'} waiting to take root` : 'Every thought has taken root'}</h1>
          <span className="muted">{week.length} this week · {week.filter((x) => !waiting(x)).length} rooted</span>
        </div>
        <div className="clearing-filter view-switch" role="group" aria-label="Show">
          {FILTERS.map(([f, label]) => <button key={f} className={filter === f ? 'tab on' : 'tab'} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>)}
        </div>
      </header>
      <CaptureBar planted={planted} fail={fail} />
      <ClearingMap notes={notes} vault={vault} open={open} hillName={hillName} newest={newest}
        find={finding || unplaced.length ? <button className="primary" disabled={!!finding} onClick={() => findAll(unplaced)}>
          {finding ? `Finding places… ${finding.done + 1} of ${finding.of}` : `Find a place for all ${unplaced.length}`}</button> : null} />
      <label className="clearing-search">
        <Search size={18} strokeWidth={1.8} aria-hidden />
        <input ref={search} type="search" value={query} placeholder="Search your thoughts, by words or task id" aria-label="Search thoughts"
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        <kbd aria-hidden>/</kbd>
      </label>
      {(filter === '' || filter === 'waiting') && (
        <section className="clearing-section" aria-labelledby="th-waiting">
          <h2 id="th-waiting" className="label">Waiting to take root · {cards.length}</h2>
          {cards.length ? (
            <ul className="seeds">
              {cards.map((t, i) => {
                const { title } = noteTitle(t.name)
                const fresh = t.path === newest
                return (
                  <li key={t.path} className={fresh ? 'seed newest' : 'seed'} style={{ animationDelay: `${0.2 + Math.min(i, 8) * 0.06}s` }}>
                    <button className="seed-open" onClick={() => open(t.path)}>
                      <span className="seed-when"><MapSymbol id="sapling" newest={fresh} />{shortWhen(t)}{fresh && plantedToday(t) && <span className="seed-pill">Just planted</span>}</span>
                      <span className="seed-title">{title}</span>
                      {t.excerpt && !sameStart(t.excerpt, title) && <span className="seed-excerpt">{t.excerpt}</span>}
                    </button>
                    <button className="seed-cta" disabled={finding?.path === t.path} onClick={() => open(t.path, true)}>
                      {finding?.path === t.path ? 'Finding its place…' : ready[t.path] ? 'See its place' : 'Find its place'}</button>
                  </li>
                )
              })}
            </ul>
          ) : <p className="muted clearing-none">{q ? 'No waiting thought matches. Try fewer words.' : 'Nothing waiting: every thought has taken root.'}</p>}
        </section>
      )}
      {(filter === '' || filter === 'rooted') && (
        <section className="clearing-section" aria-labelledby="th-rooted">
          <h2 id="th-rooted" className="label">{q || filter === 'rooted' ? 'Rooted' : 'Rooted this week'} · {rooted.length}</h2>
          {rooted.length ? <Rows notes={rooted} open={open} chips={(x) => (taskIds(x).length ? taskIds(x) : [hillName(unlink(x.data.project))].filter(Boolean))} />
            : <p className="muted clearing-none">{q ? 'No rooted thought matches.' : 'Nothing rooted this week yet.'}</p>}
        </section>
      )}
      {filter === 'meetings' && (
        <section className="clearing-section" aria-labelledby="th-meetings">
          <h2 id="th-meetings" className="label">Meetings · {meetings.length}</h2>
          {meetings.length ? <Rows notes={meetings} open={open} chips={(x) => list(x.data.tasks).map(unlink)} />
            : <p className="muted clearing-none">{q ? 'No meeting matches.' : 'No meeting notes yet. They start from the Calendar.'}</p>}
        </section>
      )}
    </main>
  )
}

// Compact rows: the map symbol, the title, a trail to the tasks it's linked to, and when.
function Rows({ notes, open, chips }: { notes: Note[]; open: (path: string) => void; chips: (n: Note) => string[] }) {
  return (
    <ul className="rooted-rows">
      {notes.map((n) => (
        <li key={n.path}>
          <button className="rooted-row" onClick={() => open(n.path)}>
            <MapSymbol id={symbolOf(n)} />
            <span className="rooted-title">{noteTitle(n.name).title}</span>
            {chips(n).length > 0 && <><span className="rooted-trail" aria-hidden />{chips(n).map((c) => <span key={c} className="chip">{c}</span>)}</>}
            <span className="note-when">{shortWhen(n)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// One row to plant a thought: saved like New thought (⌘⇧K), then it opens and the agent proposes where it belongs.
function CaptureBar({ planted, fail }: { planted: (path: string) => void; fail: (e: Error) => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  // Saving waits until a dictation is in, so the spoken part is never lost.
  const [dictating, setDictating] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  // The field grows with what you write.
  useLayoutEffect(() => {
    const t = box.current
    if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px` }
  }, [text])
  const plant = () => {
    if (dictating || saving || !text.trim()) return
    setSaving(true)
    plantThought(text).then(({ path }) => { setText(''); setSaving(false); planted(path) }, (e) => { setSaving(false); fail(e) })
  }
  return (
    <form className="capture-bar" onSubmit={(e) => { e.preventDefault(); plant() }}>
      <MapSymbol id="sapling" />
      <textarea ref={box} rows={1} value={text} placeholder="What's on your mind?" aria-label="New thought"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); plant() } }} />
      <kbd title="New thought from anywhere">⌘⇧K</kbd>
      <Dictate compact add={(said) => setText((t) => t.trim() ? `${t.trimEnd()}\n${said}` : said)} busy={setDictating} />
      <button type="submit" className="primary" disabled={saving || dictating || !text.trim()}>{saving ? 'Planting…' : 'Plant it'}</button>
    </form>
  )
}

// A hill as a few nested contours of the landscape's blob, an index contour second, the summit marked.
function HillRings({ x, y, r, rot }: { x: number; y: number; r: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      {[1, 0.74, 0.5, 0.28].map((f, k) => <path key={k} d={BLOB} className={`bt-contour h${k + 1} ${k === 1 ? 'index' : ''}`} transform={`scale(${(r / 100) * f} ${(r / 100) * f * 0.78})`} />)}
      <use href="#s-peak" x={-6} y={-8} width={12} height={12} transform={`rotate(${-rot})`} />
    </g>
  )
}
const tilt = (p: string) => ([...p].reduce((s, c) => s + c.charCodeAt(0), 0) * 37) % 30 - 15

// The survey sheet (docs/MAP-STYLE.md): saplings in the dashed clearing, trees in their project's woods. Click one to open it.
function ClearingMap({ notes, vault, open, hillName, newest, find }: {
  notes: Note[]; vault: Vault; open: (path: string) => void; hillName: (p: string) => string; newest?: string; find: React.ReactNode
}) {
  const c = useMemo(() => clearingOf(notes, vault.tasks), [notes, vault.tasks])
  const titles = new Map(notes.map((n) => [n.path, noteTitle(n.name).title]))
  const name = (p: string) => (p ? hillName(p) : 'No project').toUpperCase()
  const fresh = c.saplings.find((s) => s.path === newest)
  const place = (s: { path: string; x: number; y: number }, id: string, size: number, delay: number) => (
    <g key={s.path} className="th-place th-sprout" style={{ animationDelay: `${delay}s` }} role="button" tabIndex={0} aria-label={titles.get(s.path)}
      onClick={() => open(s.path)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(s.path))}>
      <title>{titles.get(s.path)}</title>
      <circle className="bt-hit" cx={s.x} cy={s.y} r={size * 0.7} />
      <use href={`#s-${id}`} x={s.x - size / 2} y={s.y - size / 2} width={size} height={size} />
    </g>
  )
  return (
    <figure className="th-sheet clearing-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="group"
        aria-label={`Survey sheet: ${c.saplings.length} saplings in the clearing${c.woods.length ? `; trees on ${c.woods.map((w) => `${name(w.project).toLowerCase()} (${w.trees.length})`).join(', ')}` : ''}`}>
        <defs>
          <pattern id="th-grid" width="110" height="110" patternUnits="userSpaceOnUse"><path className="bt-graticule" d="M110,0 H0 V110" /></pattern>
          <pattern id="th-wood" width="9" height="9" patternUnits="userSpaceOnUse"><circle className="bt-stipple" cx="2.5" cy="2.5" r="1.1" /><circle className="bt-stipple" cx="7" cy="7" r="1.1" /></pattern>
        </defs>
        <rect className="bt-paper" width={W} height={H} />
        <rect width={W} height={H} fill="url(#th-grid)" />
        {c.woods.map((w, i) => {
          const xs = w.trees.map((t) => t.x)
          const ys = w.trees.map((t) => t.y)
          const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
          return (
            <g key={w.project}>
              <HillRings x={w.x} y={w.y} r={w.r} rot={tilt(w.project)} />
              <ellipse cx={cx} cy={cy} rx={(Math.max(...xs) - Math.min(...xs)) / 2 + 12} ry={(Math.max(...ys) - Math.min(...ys)) / 2 + 10} fill="url(#th-wood)" />
              {w.trees.map((t, j) => place(t, 'tree', 14, 0.3 + i * 0.1 + Math.min(j, 12) * 0.03))}
              <text className="bt-hill-name" x={w.x} y={w.y + w.r * 0.78 + 18} textAnchor="middle" fontSize={12}>{name(w.project)}</text>
            </g>
          )
        })}
        <g className="bt-clearing"><ellipse cx={CLEARING.x} cy={CLEARING.y} rx={c.rx} ry={c.ry} /></g>
        {c.saplings.filter((s) => s !== fresh).map((s, i) => place(s, 'sapling', 24, 0.8 + Math.min(i, 12) * 0.06))}
        {fresh && <>
          <circle className="th-fresh-ring" cx={fresh.x} cy={fresh.y} r={13} />
          <g className="th-newest">{place(fresh, 'sapling', 26, 1.1)}</g>
          <text className="bt-time" x={fresh.x + 18} y={fresh.y - 10} fontSize={11}>{shortWhen(notes.find((n) => n.path === fresh.path)!)}</text>
        </>}
        <text className="bt-meta" x={CLEARING.x} y={Math.min(H - 8, CLEARING.y + c.ry + 18)} textAnchor="middle" fontSize={11}>
          {c.saplings.length ? `${c.saplings.length} unfiled thought${c.saplings.length === 1 ? '' : 's'}` : 'The clearing is empty'}</text>
      </svg>
      <figcaption>
        <span>Saplings wait in the clearing. Filed, they grow into trees in their project's woods.</span>
        {find}
      </figcaption>
    </figure>
  )
}

// `autoFile` asks the agent for a proposal right away, for a thought you just captured; `proposal` is one fetched before.
export function Editor({ vault, projects, path, fail, flash, onFiled, bare, autoFile, onAsked, proposal: before }: {
  vault: Vault; projects: Doc[]; path: string; fail: (e: Error) => void; flash: (m: string) => void; onFiled: () => void; bare?: boolean
  autoFile?: boolean; onAsked?: () => void; proposal?: Proposal
}) {
  const root = useRef<HTMLDivElement>(null)
  const saving = useRef<() => Promise<void> | undefined>(undefined)
  const [saved, setSaved] = useState('saved')
  const [meta, setMeta] = useState<Record<string, any>>({})
  const [proposal, setProposal] = useState(before)
  const [picked, setPicked] = useState<boolean[]>(() => before?.actions.map((a) => a.kind !== 'external') ?? [])
  const [answers, setAnswers] = useState<string[]>(() => (before?.questions ?? []).map(() => ''))
  // Every answer so far, so a second round of questions doesn't lose the first.
  const [answered, setAnswered] = useState('')
  const [filing, setFiling] = useState(false)
  // Bumped after the agent rewrote the file, so the editor reloads it.
  const [version, setVersion] = useState(0)
  const isMeeting = path.startsWith('meetings/')
  const name = path.split('/').pop()!.replace(/\.md$/, '')

  useEffect(() => {
    let crepe: Crepe | undefined
    let alive = true
    // ponytail: last write wins; editing the same file in Obsidian at the same time can lose one side.
    const typed = debounce((body: string) => api('doc', 'PUT', { path, body }).then(() => setSaved('saved'), fail), 700)
    saving.current = typed.flush
    api(`doc?path=${encodeURIComponent(path)}`).then(async (doc) => {
      if (!alive || !root.current) return
      setMeta(doc.data)
      root.current.innerHTML = ''
      crepe = new Crepe({ root: root.current, defaultValue: doc.body })
      // Only save after you've focused the editor: opening a file must not rewrite it
      // (the editor's markdown output can differ cosmetically from the file, e.g. table padding).
      let touched = false
      crepe.on((l) => l.focus(() => { touched = true }))
      crepe.on((l) => l.markdownUpdated((_ctx, md) => {
        if (!touched) return
        setSaved('editing…')
        typed(md)
      }))
      await crepe.create()
    }, fail)
    // Closing (another note, the peek, a view switch) saves what you typed in the last moment.
    return () => { alive = false; typed.flush(); crepe?.destroy() }
  }, [path, version])

  const setField = (data: Record<string, unknown>) => {
    setMeta({ ...meta, ...data })
    api('doc', 'PUT', { path, data }).catch(fail)
  }

  // With answers to the agent's questions, it proposes again with them in mind.
  async function propose(more = '') {
    const all = [answered, more].filter(Boolean).join('\n')
    setAnswered(all)
    setFiling(true)
    try {
      const p = await api('file', 'POST', { path, answers: all })
      setProposal(p)
      setPicked(p.actions.map((a: Action) => a.kind !== 'external'))
      setAnswers((p.questions ?? []).map(() => ''))
    } catch (e) { fail(e as Error) } finally { setFiling(false) }
  }
  // The Editor remounts per path (keyed), so this runs once per opened thought.
  // Asked once: opening it again later doesn't ask again.
  useEffect(() => { if (autoFile) { propose(); onAsked?.() } }, [])
  const edit = (i: number, change: Partial<Action>) =>
    setProposal((p) => p && { ...p, actions: p.actions.map((a, j) => (j === i ? { ...a, ...change } : a)) })
  // Moving the thought to another project takes the new tasks the agent put in the old one along.
  const refile = (from: string, to: string) => setProposal((p) => p && {
    ...p, actions: p.actions.map((a) => (a.kind === 'set-project' || (a.kind === 'create-task' && a.project === from) ? { ...a, project: to } : a)),
  })
  const newAnswers = () => proposal!.questions!.map((q, i) => answers[i].trim() && `Q: ${q}\nA: ${answers[i].trim()}`).filter(Boolean).join('\n')

  async function apply() {
    const actions = proposal!.actions.filter((_, i) => picked[i] && proposal!.actions[i].kind !== 'external')
    // Save what you just typed first: a save after the filing would write over the summary it added.
    await saving.current?.()
    const { done } = await api('file/apply', 'POST', { path, actions })
    flash(done.length ? done.join(', ') : 'Nothing applied')
    setProposal(undefined)
    setVersion((v) => v + 1)
    onFiled()
  }

  const canFile = isMeeting || path.startsWith('inbox/') || path.startsWith('notes/')
  // A thought's proposal opens beside the text as "Where it belongs"; a meeting's stays above it.
  const sapling = meta.status ? meta.status === 'inbox' : path.startsWith('inbox/')
  // Always there for a sapling (it waits for a place); for a rooted thought only once you ask again.
  const peek = !isMeeting && canFile && (sapling || !!proposal || filing)
  const { title, when } = noteTitle(name)
  const pick = (i: number) => setPicked(picked.map((v, j) => (j === i ? !v : v)))
  const answer = (i: number, v: string) => setAnswers(answers.map((x, j) => (j === i ? v : x)))
  return (
    <section className={`${bare ? 'editor-bare' : 'pane editor-pane'}${isMeeting ? '' : ' thought'}${peek ? ' with-peek' : ''}`}>
      <div className="editor-col">
        {!bare && <div className="editor-head">
          {isMeeting ? (
            <div className="editor-title">
              <h2 title={name}>{title}</h2>
              <span className="muted">{[when, 'Meeting', saved].filter(Boolean).join(' · ')}</span>
            </div>
          ) : (
            <div className="editor-title">
              <span className="th-status-line">
                <span className="th-status"><MapSymbol id={sapling ? 'sapling' : 'tree'} />{sapling ? 'Sapling, not filed yet' : 'Rooted'}{!sapling && meta.project ? ` on ${unlink(meta.project)}` : ''}</span>
                <span className="th-meta">{[when, saved].filter(Boolean).join(' · ')}</span>
              </span>
              <h2 className="page-title" title={name}>{title}</h2>
            </div>
          )}
          {canFile && !peek && <button className="primary" disabled={filing} onClick={() => propose()}
            title={isMeeting ? 'Summary, action points and tasks from your notes and the transcript' : 'Let the agent propose where this thought belongs'}>
            {filing ? 'Thinking…' : isMeeting ? 'Process meeting' : 'Find its place'}</button>}
        </div>}
        {bare && <div className="muted save-state">{saved}</div>}
        {isMeeting && <MeetingBar vault={vault} projects={projects} name={name} meta={meta} setField={setField} fail={fail} />}
        {isMeeting && proposal && (
          <div className="proposal">
            <p><strong>{proposal.summary}</strong></p>
            {!!proposal.questions?.length && (
              <div className="questions">
                {proposal.questions.map((q, i) => (
                  <label key={i} className="field"><span>{q}</span>
                    <input value={answers[i] ?? ''} onChange={(e) => answer(i, e.target.value)} />
                  </label>
                ))}
                <button disabled={filing || !answers.some((a) => a.trim())} onClick={() => propose(newAnswers())}>{filing ? 'Thinking…' : 'Answer and propose again'}</button>
              </div>
            )}
            <ul>
              {proposal.actions.map((a, i) => (
                <li key={i}>
                  <label>
                    {a.kind !== 'external' && <input type="checkbox" checked={picked[i]} onChange={() => pick(i)} />}
                    <span className="chip">{a.kind}</span>{' '}
                    {a.kind === 'create-task' ? <>New task <input aria-label="Task title" value={a.title ?? ''} onChange={(e) => edit(i, { title: e.target.value })} /> {a.priority} {a.project ? `in ${a.project}` : ''}</>
                      : describe(a)}
                  </label>
                  <div className="muted">{a.reason}</div>
                </li>
              ))}
            </ul>
            <div className="row-actions">
              <button onClick={() => setProposal(undefined)}>Cancel</button>
              <button className="primary" onClick={() => apply().catch(fail)}>Apply selected</button>
            </div>
          </div>
        )}
        <div className="editor milkdown-host" ref={root} />
      </div>
      {peek && (
        <aside className="belongs" aria-label="Where it belongs" aria-busy={filing}>
          <div className="belongs-head">
            <span className="label">Where it belongs</span>
            {proposal && <IconButton icon={X} label="Not now" onClick={() => setProposal(undefined)} />}
          </div>
          <TrailMap actions={proposal?.actions ?? []} picked={picked} project={unlink(meta.project)} />
          {!proposal ? <p className="muted">{filing ? 'The agent is working out where this belongs…' : 'Not filed yet. The agent proposes a hill, tasks and related thoughts; you pick what to plant.'}</p> : <>
            <p className="belongs-summary">{proposal.summary}</p>
            <ul className="belongs-actions">
              {proposal.actions.map((a, i) => (
                <li key={i}><label className="act" style={{ animationDelay: `${0.5 + i * 0.1}s` }}>
                  {a.kind !== 'external' ? <input type="checkbox" checked={picked[i]} onChange={() => pick(i)} /> : <span className="act-pad" />}
                  <span className="act-body">
                    <span className={`act-kind ${a.kind}`}>{kindLabel(a)}</span>
                    {a.kind === 'set-project' ? <span>File under <ProjectSelect projects={projects} all={vault.projects} value={a.project ?? ''} onChange={(project) => refile(a.project, project)} /></span>
                      : a.kind === 'create-task' ? <>
                        <input aria-label="Task title" value={a.title ?? ''} onChange={(e) => edit(i, { title: e.target.value })} />
                        {a.project && <span className="act-reason">in {a.project}</span>}
                      </> : <span className="act-what">{describe(a)}</span>}
                    <span className="act-reason">{a.reason}</span>
                  </span>
                </label></li>
              ))}
            </ul>
            {!!proposal.questions?.length && (
              <div className="belongs-ask">
                {proposal.questions.map((q, i) => (
                  <label key={i}><span>{q}</span>
                    <input value={answers[i] ?? ''} placeholder="Your answer" onChange={(e) => answer(i, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !filing && answers.some((x) => x.trim()) && propose(newAnswers())} />
                  </label>
                ))}
                <button disabled={filing || !answers.some((a) => a.trim())} onClick={() => propose(newAnswers())}>{filing ? 'Thinking…' : 'Answer and propose again'}</button>
              </div>
            )}
          </>}
          <div className="belongs-foot">
            {!proposal && <button className="primary" disabled={filing} onClick={() => propose()}>{filing ? 'Thinking…' : 'Find its place'}</button>}
            {proposal && <button onClick={() => setProposal(undefined)}>Not now</button>}
            {proposal && (() => {
              const n = proposal ? proposal.actions.filter((a, i) => picked[i] && a.kind !== 'external').length : 0
              return <button className="primary" disabled={!n || filing} onClick={() => apply().catch(fail)}>{n === 1 ? 'Plant 1 change' : `Plant ${n} changes`}</button>
            })()}
          </div>
        </aside>
      )}
    </section>
  )
}

const KIND_LABEL: Record<string, string> = {
  'set-project': 'Plant on a hill', 'new-project': 'A new hill', 'append-to-task': 'Add to a task', 'link-task': 'Link a task',
  'link-note': 'Link a thought', 'link-meeting': 'Link a meeting', external: 'Outside the vault',
}
const kindLabel = (a: Action) => (a.kind === 'create-task' ? `New task · ${prioLabel(a.priority)}` : KIND_LABEL[a.kind] ?? a.kind)

// The proposal as a trail map: this thought an ochre sapling in its clearing, a lit trail to the hill it would
// be planted on, dashed trails to the tasks it would make or join (base camps) and the thoughts it would link (trees).
function TrailMap({ actions, picked, project }: { actions: Action[]; picked: boolean[]; project: string }) {
  const at = actions.map((a, i) => ({ a, i }))
  const hill = at.find(({ a }) => a.kind === 'set-project' || a.kind === 'new-project')
  const hillName = hill?.a.projectName || hill?.a.project || project
  const camps = at.filter(({ a }) => ['create-task', 'append-to-task', 'link-task'].includes(a.kind)).slice(0, 4)
  const trees = at.filter(({ a }) => a.kind === 'link-note' || a.kind === 'link-meeting').slice(0, 4)
  const from = { x: 76, y: 144 }
  const top = { x: 300, y: 70 }
  const trail = (b: { x: number; y: number }) => `M${from.x},${from.y} Q${(from.x + b.x) / 2},${Math.min(from.y, b.y) - 10} ${b.x},${b.y}`
  const far = (i?: number) => (i !== undefined && !picked[i] ? ' far' : '')
  const says = [hillName && `the ${hillName} hill`, camps.length && `${camps.length} task${camps.length === 1 ? '' : 's'}`, trees.length && `${trees.length} related note${trees.length === 1 ? '' : 's'}`].filter(Boolean)
  return (
    <svg className="th-sheet trail-map" viewBox="0 0 380 200" role="img" aria-label={says.length ? `Trail map: from this thought to ${says.join(', ')}` : 'Trail map: this thought in its clearing'}>
      <rect className="bt-paper" width="380" height="200" rx="22" />
      {hillName && <HillRings x={top.x} y={top.y} r={62} rot={tilt(hillName)} />}
      <g className="bt-clearing"><ellipse cx={from.x} cy={from.y + 6} rx="52" ry="24" /></g>
      {hillName && <path className={`th-lit${far(hill?.i)}`} pathLength={1} d={trail({ x: top.x - 20, y: top.y + 6 })} />}
      {camps.map(({ i }, k) => {
        const b = { x: 170 + k * 32, y: 32 + (k % 2) * 16 }
        return <g key={i} className={far(i)}><path className="bt-trail th-fade" d={trail(b)} /><use href="#s-todo" x={b.x - 8} y={b.y - 8} width={16} height={16} className="th-sprout" /></g>
      })}
      {trees.map(({ i }, k) => {
        const b = { x: 262 + k * 30, y: 160 + (k % 2) * 12 }
        return <g key={i} className={far(i)}><path className="bt-trail similar th-fade" d={trail(b)} /><use href={actions[i].kind === 'link-meeting' ? '#s-hut' : '#s-tree'} x={b.x - 9} y={b.y - 9} width={18} height={18} className="th-sprout" /></g>
      })}
      <circle className="th-fresh-ring" cx={from.x} cy={from.y} r="15" />
      <g className="th-newest"><use href="#s-sapling" x={from.x - 15} y={from.y - 16} width={30} height={30} /></g>
      {hillName && <text className="bt-hill-name" x={top.x} y={top.y + 62} textAnchor="middle" fontSize={10.5}>{hillName.toUpperCase()}</text>}
      {camps.length > 0 && <text className="bt-meta" x={170} y={16} fontSize={10.5}>{camps.length === 1 ? 'TASK' : 'TASKS'}</text>}
      {trees.length > 0 && <text className="bt-meta" x={262} y={194} fontSize={10.5}>RELATED</text>}
      <text className="bt-meta" x={from.x} y={from.y + 44} textAnchor="middle" fontSize={10.5}>THIS THOUGHT</text>
    </svg>
  )
}

// Meeting properties (like the Notion database columns), linked tasks, recording and the live transcript.
function MeetingBar({ vault, projects, name, meta, setField, fail }: {
  vault: Vault; projects: Doc[]; name: string; meta: Record<string, any>; setField: (d: Record<string, unknown>) => void; fail: (e: Error) => void
}) {
  const [transcript, setTranscript] = useState('')
  const [open, setOpen] = useState(false)
  const loadTranscript = () => api(`transcript?name=${encodeURIComponent(name)}`).then((r) => setTranscript(r.text.replace(/^---[\s\S]*?---\n/, '').trim()), fail)
  useEffect(() => { loadTranscript() }, [name])
  const tasks = list(meta.tasks).map(unlink)

  return (
    <div className="meeting-bar">
      <div className="meeting-props">
        <label>Date <input type="date" value={meta.date ?? ''} onChange={(e) => setField({ date: e.target.value })} /></label>
        <label>Time <input type="time" value={meta.time ?? ''} onChange={(e) => setField({ time: e.target.value })} /></label>
        <label>Project
          <ProjectSelect projects={projects} all={vault.projects} value={unlink(meta.project)} none="None"
            onChange={(name) => setField({ project: name ? `[[${name}]]` : '' })} />
        </label>
        <label className="grow">People
          <input defaultValue={list(meta.attendees).join(', ')} key={list(meta.attendees).join(',')} placeholder="Jan, Marc"
            onBlur={(e) => setField({ attendees: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </label>
      </div>
      <div className="meeting-actions">
        <Recorder name={name} onChunk={loadTranscript} fail={fail} />
        <button className="icon" onClick={() => setOpen(!open)} aria-expanded={open}>
          Transcript {transcript ? `(${transcript.split(/\s+/).length} words)` : ''} {open ? <ChevronUp size={14} strokeWidth={1.8} aria-hidden /> : <ChevronDown size={14} strokeWidth={1.8} aria-hidden />}
        </button>
        {tasks.map((t) => <span key={t} className="chip">{t} {vault.tasks.find((x) => x.name === t)?.data.title?.slice(0, 40)}</span>)}
      </div>
      {open && <div className="transcript">{transcript || <span className="muted">Nothing transcribed yet.</span>}</div>}
    </div>
  )
}

// Turns audio into 16 kHz PCM (the AudioContext resamples), posted 100 ms at a time. Any message
// to it flushes what it still holds, then it answers 'flushed'.
const PCM_WORKLET = `registerProcessor('pcm', class extends AudioWorkletProcessor {
  buf = new Int16Array(1600); n = 0
  constructor() {
    super()
    this.port.onmessage = () => { this.port.postMessage(this.buf.slice(0, this.n)); this.n = 0; this.port.postMessage('flushed') }
  }
  process([input]) {
    for (const x of input[0] ?? []) {
      this.buf[this.n++] = Math.max(-1, Math.min(1, x)) * 32767
      if (this.n === this.buf.length) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Int16Array(1600); this.n = 0 }
    }
    return true
  }
})`

// Streams each source to local Whisper over /listen, which writes every finished sentence to transcripts/,
// labelled Me / Others when the call's audio is recorded too. Meanwhile it shows what is being said.
function Recorder({ name, onChunk, fail }: { name: string; onChunk: () => void; fail: (e: Error) => void }) {
  const [rec, setRec] = useState<{ stop: () => void; startedAt: number; labelled: boolean }>()
  const [withCall, setWithCall] = useState(() => load('meeting-call-audio', true))
  const [live, setLive] = useState<Partial<Record<Speaker, string>>>({})
  const [, tick] = useState(0)
  useEffect(() => { if (!rec) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [rec])
  useEffect(() => () => rec?.stop(), [rec])

  async function start() {
    try {
      // Online meetings: also capture what the others say, from the call's tab or (desktop Teams, Zoom)
      // the whole screen's system audio. Each source is transcribed on its own, so lines say who spoke.
      // Asked before the mic: Chrome only allows screen sharing right after the click.
      let call: MediaStream | undefined
      if (withCall) {
        try {
          const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include' } as DisplayMediaStreamOptions)
          display.getVideoTracks().forEach((t) => t.stop())
          if (display.getAudioTracks().length) call = new MediaStream(display.getAudioTracks())
          else flash('No call audio shared; recording your microphone only.')
        } catch (e) { flash(`Call audio not shared (${(e as Error).message}); recording your microphone only.`) }
      }
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .catch((e) => { call?.getTracks().forEach((t) => t.stop()); throw e })
      const sources: { who: Speaker; stream: MediaStream }[] = [{ who: 'me', stream: mic }, ...(call ? [{ who: 'others' as const, stream: call }] : [])]
      // With only the microphone, it hears everyone in the room: no label.
      const labelled = sources.length > 1

      let stopped = false
      const ctx = new AudioContext({ sampleRate: 16_000 })
      const ends: (() => void)[] = []
      const release = () => {
        sources.forEach((s) => s.stream.getTracks().forEach((t) => t.stop()))
        ends.forEach((end) => end())
        // Time for the worklets to flush their last 100 ms.
        setTimeout(() => ctx.close(), 1000)
      }
      try {
        await ctx.resume()
        const worklet = URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'text/javascript' }))
        await ctx.audioWorklet.addModule(worklet).finally(() => URL.revokeObjectURL(worklet))
        for (const { who, stream } of sources) {
          const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/listen?name=${encodeURIComponent(name)}${labelled ? `&who=${who}` : ''}`)
          // Its output stays silent; connected to the speakers only so Chrome keeps it running.
          const pcm = new AudioWorkletNode(ctx, 'pcm', { channelCount: 1, channelCountMode: 'explicit' })
          pcm.port.onmessage = (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(e.data === 'flushed' ? 'end' : e.data) }
          ctx.createMediaStreamSource(stream).connect(pcm).connect(ctx.destination)
          // Ending sends what the worklet still holds, then "end": the server saves the last words and closes.
          let ending = false
          const end = () => {
            if (ending) return
            ending = true
            if (ws.readyState === WebSocket.OPEN) pcm.port.postMessage('flush')
            else ws.close()
          }
          ends.push(end)
          // Sharing stopped from Chrome's "Stop sharing" bar: only this source ends.
          stream.getAudioTracks().forEach((t) => t.addEventListener('ended', end))
          ws.onmessage = (e) => {
            const msg = JSON.parse(e.data)
            if (msg.error) fail(new Error(msg.error))
            if ('partial' in msg) setLive((l) => ({ ...l, [who]: msg.partial }))
            if ('final' in msg) { setLive((l) => ({ ...l, [who]: '' })); if (msg.final) onChunk() }
          }
          ws.onclose = () => { if (!stopped && !ending) fail(new Error('Transcription stopped: lost the connection to the board')) }
        }
      } catch (e) { stopped = true; release(); throw e }
      setLive({})
      setRec({
        startedAt: Date.now(),
        labelled,
        stop: () => {
          if (stopped) return
          stopped = true
          release()
        },
      })
    } catch (e) { fail(e as Error) }
  }

  const flash = (m: string) => fail(new Error(m))
  const secs = rec ? Math.floor((Date.now() - rec.startedAt) / 1000) : 0
  // The end of what is being said: the newest words matter.
  const speaking = (Object.entries(live) as [Speaker, string][]).filter(([, t]) => t)
    .map(([who, t]) => <span key={who} className="rec-live muted">{rec?.labelled ? `${SPEAKERS[who]}: ` : ''}{t.length > 140 ? `…${t.slice(-140)}` : t}</span>)
  return rec ? (
    <>
      <span className="recorder on">
        <button className="rec-btn on" onClick={() => { rec.stop(); setRec(undefined) }}><Square size={12} strokeWidth={1.8} fill="currentColor" aria-hidden /> Stop</button>
        <span className="rec-dot" aria-hidden /> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </span>
      {speaking}
    </>
  ) : (
    <span className="recorder">
      <button className="rec-btn" onClick={start} title="Transcribe this meeting locally with Whisper (audio never leaves your Mac)"><Circle size={12} strokeWidth={1.8} fill="currentColor" aria-hidden /> Transcribe</button>
      <label className="muted" title="For online meetings: also transcribe the other participants. Share the call's tab with 'Share tab audio', or for a desktop app (Teams, Zoom) the entire screen with 'Share system audio'. Use headphones, or the mic hears the others too.">
        <input type="checkbox" checked={withCall} onChange={(e) => { setWithCall(e.target.checked); save('meeting-call-audio', e.target.checked) }} /> + others (call audio)
      </label>
    </span>
  )
}

function describe(a: Action) {
  switch (a.kind) {
    case 'new-project': return <>New project <b>{a.projectName || a.project}</b> ({a.context}, {a.account})</>
    case 'append-to-task': return <>Add to <b>{a.task}</b>: {a.text?.slice(0, 120)}</>
    case 'link-task': return <>Link to task <b>{a.task}</b></>
    case 'link-note': return <>Link to <b>{a.note?.replace(/^.*\//, '').replace(/\.md$/, '')}</b></>
    case 'link-meeting': return <>Link to meeting <b>{a.meeting}</b></>
    case 'summary': return <>Write the Summary: <span className="pre">{a.text}</span></>
    case 'action-points': return <>Write the Action Points: <span className="pre">{a.text}</span></>
    case 'attendees': return <>People: <b>{(a.people ?? []).join(', ')}</b></>
    case 'external': return <>Update outside: {a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.url}</a> : null} {a.text}</>
    default: return a.title ?? ''
  }
}

// Speak a thought: one recording, transcribed by the local Whisper the meetings use, added to the text.
// Errors show here, not in a toast: the panel would cover it, and an install hint needs time to read.
// `compact`: an icon button only, for the capture bar.
export function Dictate({ add, busy, compact }: { add: (text: string) => void; busy: (on: boolean) => void; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle')
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder>(undefined)
  const gone = useRef(false)
  useEffect(() => busy(state !== 'idle'), [state, busy])
  // Closing the panel mid-recording drops the audio and frees the mic.
  useEffect(() => () => {
    gone.current = true
    const r = recorder.current
    if (r?.state === 'recording') { r.onstop = () => r.stream.getTracks().forEach((t) => t.stop()); r.stop() }
  }, [])

  async function start() {
    setError('')
    setState('starting')
    let mic: MediaStream | undefined
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (gone.current) return mic.getTracks().forEach((t) => t.stop())
      const r = new MediaRecorder(mic, { mimeType: 'audio/webm;codecs=opus' })
      const parts: Blob[] = []
      r.ondataavailable = (e) => parts.push(e.data)
      r.onstop = () => {
        r.stream.getTracks().forEach((t) => t.stop())
        setState('transcribing')
        fetch('/api/transcribe', { method: 'POST', body: new Blob(parts, { type: 'audio/webm' }) })
          .then(async (res) => {
            const out = await res.json()
            if (!res.ok) throw new Error(out.error)
            if (out.text) add(out.text)
            else setError('Nothing heard. Try again, a little closer to the mic.')
          })
          .catch((e) => setError(e.message || 'Transcription failed'))
          .finally(() => setState('idle'))
      }
      r.start()
      recorder.current = r
      setState('recording')
    } catch (e) {
      mic?.getTracks().forEach((t) => t.stop())
      setError((e as Error).message)
      setState('idle')
    }
  }

  return (
    <div className="dictate">
      {state === 'recording'
        ? <IconButton icon={Square} label="Stop and transcribe" showLabel={!compact} active onClick={() => recorder.current?.stop()} />
        : <IconButton icon={Mic} label={state === 'transcribing' ? 'Transcribing…' : 'Dictate (local Whisper)'} showLabel={!compact} disabled={state !== 'idle'} onClick={start} />}
      {error && <span className="dictate-error" role="alert">{error}</span>}
    </div>
  )
}
