import { useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import { ago, api, list, unlink, type Doc, type Vault } from './lib'
import { ProjectSelect } from './Home'

type Note = { path: string; name: string; data: Record<string, any>; mtime: string }
type Action = Record<string, any> & { kind: string; reason: string }
const FILTERS = [['', 'All'], ['inbox/', 'Inbox'], ['notes/', 'Notes'], ['meetings/', 'Meetings']]

// Notes and meeting notes: write freely (saved as you type), then let the agent propose where it goes.
export default function Notes({ vault, projects, path, go, fail, flash }: {
  vault: Vault; projects: Doc[]; path?: string; go: (path: string) => void; fail: (e: Error) => void; flash: (m: string) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [filter, setFilter] = useState('')
  const refresh = () => api('notes').then(setNotes, fail)
  useEffect(() => { refresh() }, [path])

  async function create() {
    const title = prompt('Title for the new note', '') ?? ''
    const { path: p } = await api('notes', 'POST', { title })
    go(p)
  }

  return (
    <main className="notes">
      <nav className="pane note-list" aria-label="Notes">
        <button className="primary" onClick={() => create().catch(fail)}>+ New note</button>
        <div className="note-filter" role="group" aria-label="Show">
          {FILTERS.map(([f, label]) => <button key={f} className={filter === f ? 'tab on' : 'tab'} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>)}
        </div>
        {notes.filter((n) => n.path.startsWith(filter)).map((n) => (
          <button key={n.path} className={n.path === path ? 'proj on' : 'proj'} onClick={() => go(n.path)}>
            {n.path.startsWith('meetings/') ? <span aria-hidden>🗒</span> : <span className={`dot ${n.data.status === 'inbox' ? 'inbox' : 'filed'}`} title={n.data.status ?? ''} />}
            <span className="proj-name">{n.name}</span>
            <span className="muted">{ago(n.mtime)}</span>
          </button>
        ))}
      </nav>
      {path ? <Editor key={path} vault={vault} projects={projects} path={path} fail={fail} flash={flash} onFiled={refresh} /> : (
        <section className="pane empty-note">
          <h2>Write first, file later</h2>
          <p>Start a note and just type: findings, thoughts, a first ADR draft. It saves as you go. When you're done, <strong>File it</strong>: the agent proposes a project, tasks, a meeting link, or what to update outside (Notion, an ADR). You tick what you want.</p>
          <p>Meeting notes start from the Calendar: click a day or a meeting.</p>
        </section>
      )}
    </main>
  )
}

export function Editor({ vault, projects, path, fail, flash, onFiled, bare }: {
  vault: Vault; projects: Doc[]; path: string; fail: (e: Error) => void; flash: (m: string) => void; onFiled: () => void; bare?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const [saved, setSaved] = useState('saved')
  const [meta, setMeta] = useState<Record<string, any>>({})
  const [proposal, setProposal] = useState<{ summary: string; actions: Action[] }>()
  const [picked, setPicked] = useState<boolean[]>([])
  const [filing, setFiling] = useState(false)
  // Bumped after the agent rewrote the file, so the editor reloads it.
  const [version, setVersion] = useState(0)
  const isMeeting = path.startsWith('meetings/')
  const name = path.split('/').pop()!.replace(/\.md$/, '')

  useEffect(() => {
    let crepe: Crepe | undefined
    let timer: number
    let alive = true
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
        clearTimeout(timer)
        // ponytail: last write wins; editing the same file in Obsidian at the same time can lose one side.
        timer = window.setTimeout(() => api('doc', 'PUT', { path, body: md }).then(() => setSaved('saved'), fail), 700)
      }))
      await crepe.create()
    }, fail)
    return () => { alive = false; clearTimeout(timer); crepe?.destroy() }
  }, [path, version])

  const setField = (data: Record<string, unknown>) => {
    setMeta({ ...meta, ...data })
    api('doc', 'PUT', { path, data }).catch(fail)
  }

  async function propose() {
    setFiling(true)
    try {
      const p = await api('file', 'POST', { path })
      setProposal(p)
      setPicked(p.actions.map((a: Action) => a.kind !== 'external'))
    } catch (e) { fail(e as Error) } finally { setFiling(false) }
  }

  async function apply() {
    const actions = proposal!.actions.filter((_, i) => picked[i] && proposal!.actions[i].kind !== 'external')
    const { done } = await api('file/apply', 'POST', { path, actions })
    flash(done.length ? done.join(', ') : 'Nothing applied')
    setProposal(undefined)
    setVersion((v) => v + 1)
    onFiled()
  }

  const canFile = isMeeting || path.startsWith('inbox/') || path.startsWith('notes/')
  return (
    <section className={bare ? 'editor-bare' : 'pane editor-pane'}>
      {!bare && <div className="editor-head">
        <h2>{name}</h2>
        <span className="muted">{path.split('/')[0]} · {saved}{!isMeeting && meta.project ? ` · ${meta.project}` : ''}</span>
        <div className="spacer" />
        {canFile && <button className="primary" disabled={filing} onClick={propose}
          title={isMeeting ? 'Summary, action points and tasks from your notes and the transcript' : 'Let the agent propose where this note belongs'}>
          {filing ? 'Thinking…' : isMeeting ? 'Process meeting' : 'File it'}</button>}
      </div>}
      {bare && <div className="muted save-state">{saved}</div>}
      {isMeeting && <MeetingBar vault={vault} projects={projects} name={name} meta={meta} setField={setField} fail={fail} />}
      {proposal && (
        <div className="proposal">
          <p><strong>{proposal.summary}</strong></p>
          <ul>
            {proposal.actions.map((a, i) => (
              <li key={i}>
                <label>
                  {a.kind !== 'external' && <input type="checkbox" checked={picked[i]} onChange={() => setPicked(picked.map((v, j) => (j === i ? !v : v)))} />}
                  <span className="chip">{a.kind}</span>{' '}
                  {describe(a)}
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
    </section>
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
          Transcript {transcript ? `(${transcript.split(/\s+/).length} words)` : ''} {open ? '▴' : '▾'}
        </button>
        {tasks.map((t) => <span key={t} className="chip">{t} {vault.tasks.find((x) => x.name === t)?.data.title?.slice(0, 40)}</span>)}
      </div>
      {open && <div className="transcript">{transcript || <span className="muted">Nothing transcribed yet.</span>}</div>}
    </div>
  )
}

const CHUNK_MS = 30_000

// Records in 30-second, self-contained chunks and sends each to local Whisper; text lands in transcripts/.
function Recorder({ name, onChunk, fail }: { name: string; onChunk: () => void; fail: (e: Error) => void }) {
  const [rec, setRec] = useState<{ stop: () => void; startedAt: number }>()
  const [withTab, setWithTab] = useState(false)
  const [pending, setPending] = useState(0)
  const [, tick] = useState(0)
  useEffect(() => { if (!rec) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [rec])
  useEffect(() => () => rec?.stop(), [rec])

  async function start() {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const streams = [mic]
      // Online meetings: also capture the call's tab audio, so the other side is in the transcript.
      if (withTab) {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        display.getVideoTracks().forEach((t) => t.stop())
        if (!display.getAudioTracks().length) flash('No tab audio shared; recording your microphone only.')
        streams.push(display)
      }
      const ctx = new AudioContext()
      const out = ctx.createMediaStreamDestination()
      for (const s of streams) if (s.getAudioTracks().length) ctx.createMediaStreamSource(s).connect(out)

      let running = true
      const loop = () => {
        if (!running) return
        const r = new MediaRecorder(out.stream, { mimeType: 'audio/webm;codecs=opus' })
        const at = new Date().toISOString()
        const parts: Blob[] = []
        r.ondataavailable = (e) => parts.push(e.data)
        r.onstop = () => {
          const blob = new Blob(parts, { type: 'audio/webm' })
          if (blob.size > 2000) {
            setPending((n) => n + 1)
            fetch(`/api/transcribe?name=${encodeURIComponent(name)}&at=${encodeURIComponent(at)}`, { method: 'POST', body: blob })
              .then(async (res) => { if (!res.ok) throw new Error((await res.json()).error) })
              .then(onChunk, fail)
              .finally(() => setPending((n) => n - 1))
          }
          loop()
        }
        r.start()
        setTimeout(() => r.state === 'recording' && r.stop(), CHUNK_MS)
        stopCurrent = () => { running = false; if (r.state === 'recording') r.stop() }
      }
      let stopCurrent = () => {}
      loop()
      setRec({
        startedAt: Date.now(),
        stop: () => { stopCurrent(); setTimeout(() => { streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); ctx.close() }, 500) },
      })
    } catch (e) { fail(e as Error) }
  }

  const flash = (m: string) => fail(new Error(m))
  const secs = rec ? Math.floor((Date.now() - rec.startedAt) / 1000) : 0
  return rec ? (
    <span className="recorder on">
      <button className="rec-btn on" onClick={() => { rec.stop(); setRec(undefined) }}>■ Stop</button>
      <span className="rec-dot" aria-hidden /> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      {pending > 0 && <span className="muted"> · transcribing…</span>}
    </span>
  ) : (
    <span className="recorder">
      <button className="rec-btn" onClick={start} title="Transcribe this meeting locally with Whisper (audio never leaves your Mac)">● Transcribe</button>
      <label className="muted" title="For online meetings: also capture the call's browser tab (pick the tab and tick 'share tab audio')">
        <input type="checkbox" checked={withTab} onChange={(e) => setWithTab(e.target.checked)} /> + call tab audio
      </label>
      {pending > 0 && <span className="muted">transcribing…</span>}
    </span>
  )
}

function describe(a: Action) {
  switch (a.kind) {
    case 'set-project': return <>File under <b>{a.project}</b></>
    case 'new-project': return <>New project <b>{a.projectName || a.project}</b> ({a.context}, {a.account})</>
    case 'create-task': return <>New task <b>{a.title}</b> {a.priority} {a.project ? `in ${a.project}` : ''}</>
    case 'append-to-task': return <>Add to <b>{a.task}</b>: {a.text?.slice(0, 120)}</>
    case 'link-meeting': return <>Link to meeting <b>{a.meeting}</b></>
    case 'summary': return <>Write the Summary: <span className="pre">{a.text}</span></>
    case 'action-points': return <>Write the Action Points: <span className="pre">{a.text}</span></>
    case 'attendees': return <>People: <b>{(a.people ?? []).join(', ')}</b></>
    case 'external': return <>Update outside: {a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.url}</a> : null} {a.text}</>
    default: return a.title ?? ''
  }
}
