import { useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { ChevronDown, ChevronUp, Circle, NotebookText, Plus, Square } from 'lucide-react'
import '@milkdown/crepe/theme/common/style.css'
import { SPEAKERS, ago, api, debounce, list, noteTitle, unlink, type Doc, type Speaker, type Vault } from './lib'
import { IconButton } from './ui'
import { ProjectSelect, load, save } from './Home'

type Note = { path: string; name: string; data: Record<string, any>; mtime: string; excerpt: string }
type Action = Record<string, any> & { kind: string; reason: string }
// A captured thought is named after its first line: then the preview would only repeat the title.
const sameStart = (a: string, b: string) => a.slice(0, 24).toLowerCase() === b.slice(0, 24).toLowerCase()
const FILTERS = [['', 'All'], ['inbox/', 'Inbox'], ['notes/', 'Filed'], ['meetings/', 'Meetings']]

// Thoughts and meeting notes: write freely (saved as you type), then let the agent propose where it goes.
export default function Notes({ vault, projects, path, go, capture, fail, flash }: {
  vault: Vault; projects: Doc[]; path?: string; go: (path: string) => void; capture: () => void; fail: (e: Error) => void; flash: (m: string) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [filter, setFilter] = useState('')
  const refresh = () => api('notes').then(setNotes, fail)
  // The vault changes when a thought is captured or filed elsewhere, so the list follows it.
  useEffect(() => { refresh() }, [path, vault])
  const shown = notes.filter((n) => n.path.startsWith(filter))

  return (
    <main className="notes">
      <nav className="pane note-list" aria-label="Thoughts">
        <div className="note-list-head">
          <IconButton icon={Plus} label="New thought" showLabel primary onClick={capture} />
          <div className="note-filter view-switch" role="group" aria-label="Show">
            {FILTERS.map(([f, label]) => <button key={f} className={filter === f ? 'tab on' : 'tab'} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>)}
          </div>
        </div>
        <ul className="note-rows">
          {shown.map((n) => {
            const { title, when } = noteTitle(n.name)
            const inbox = n.data.status === 'inbox'
            return (
              <li key={n.path}>
                <button className={n.path === path ? 'note-row on' : 'note-row'} aria-current={n.path === path ? 'true' : undefined} onClick={() => go(n.path)}>
                  <span className="note-row-title">
                    {n.path.startsWith('meetings/') ? <NotebookText size={14} strokeWidth={1.8} className="note-mark" aria-label="Meeting" />
                      : <span className={`dot ${inbox ? 'inbox' : 'filed'}`} title={inbox ? 'Not filed yet' : 'Filed'} />}
                    <span className="note-row-name">{title}</span>
                  </span>
                  <span className="note-row-meta"><span className="note-when">{when || ago(n.mtime)}</span>{n.excerpt && !sameStart(n.excerpt, title) && <span className="note-excerpt">{n.excerpt}</span>}</span>
                </button>
              </li>
            )
          })}
          {!shown.length && <li className="muted note-none">{filter === 'inbox/' ? 'Inbox zero: every thought is filed.' : 'Nothing here yet.'}</li>}
        </ul>
      </nav>
      {path ? <Editor key={path} vault={vault} projects={projects} path={path} fail={fail} flash={flash} onFiled={refresh} /> : (
        <section className="pane empty-note">
          <h2>Capture first, file later</h2>
          <p>Jot down a thought from anywhere with <kbd>⌘⇧K</kbd> (<kbd>Ctrl+Shift+K</kbd>): an idea, a finding, a blog draft. It's saved as-is. Then the agent proposes where it belongs: a project, related thoughts and tasks to link, new tasks, or what to update outside (Notion, an ADR). When it isn't sure, it asks. You tick and edit what you want.</p>
          <p>Meeting notes start from the Calendar: click a day or a meeting.</p>
        </section>
      )}
    </main>
  )
}

// `autoFile` asks the agent for a proposal right away, for a thought you just captured.
export function Editor({ vault, projects, path, fail, flash, onFiled, bare, autoFile }: {
  vault: Vault; projects: Doc[]; path: string; fail: (e: Error) => void; flash: (m: string) => void; onFiled: () => void; bare?: boolean; autoFile?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const saving = useRef<() => Promise<void> | undefined>(undefined)
  const [saved, setSaved] = useState('saved')
  const [meta, setMeta] = useState<Record<string, any>>({})
  const [proposal, setProposal] = useState<{ summary: string; actions: Action[]; questions?: string[] }>()
  const [picked, setPicked] = useState<boolean[]>([])
  const [answers, setAnswers] = useState<string[]>([])
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
  useEffect(() => { if (autoFile) propose() }, [])
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
  return (
    <section className={bare ? 'editor-bare' : 'pane editor-pane'}>
      {!bare && <div className="editor-head">
        <div className="editor-title">
          <h2 title={name}>{noteTitle(name).title}</h2>
          <span className="muted">{[noteTitle(name).when, isMeeting ? 'Meeting' : path.startsWith('inbox/') ? 'Thought, not filed yet' : 'Thought', !isMeeting && meta.project ? unlink(meta.project) : '', saved].filter(Boolean).join(' · ')}</span>
        </div>
        {canFile && <button className="primary" disabled={filing} onClick={() => propose()}
          title={isMeeting ? 'Summary, action points and tasks from your notes and the transcript' : 'Let the agent propose where this thought belongs'}>
          {filing ? 'Thinking…' : isMeeting ? 'Process meeting' : 'File it'}</button>}
      </div>}
      {bare && <div className="muted save-state">{saved}</div>}
      {isMeeting && <MeetingBar vault={vault} projects={projects} name={name} meta={meta} setField={setField} fail={fail} />}
      {!proposal && filing && autoFile && <div className="proposal muted">Saved. The agent is working out where this belongs…</div>}
      {proposal && (
        <div className="proposal">
          <p><strong>{proposal.summary}</strong></p>
          {!!proposal.questions?.length && (
            <div className="questions">
              {proposal.questions.map((q, i) => (
                <label key={i} className="field"><span>{q}</span>
                  <input value={answers[i] ?? ''} onChange={(e) => setAnswers(answers.map((v, j) => (j === i ? e.target.value : v)))} />
                </label>
              ))}
              <button disabled={filing || !answers.some((a) => a.trim())} onClick={() => propose(newAnswers())}>{filing ? 'Thinking…' : 'Answer and propose again'}</button>
            </div>
          )}
          <ul>
            {proposal.actions.map((a, i) => (
              <li key={i}>
                <label>
                  {a.kind !== 'external' && <input type="checkbox" checked={picked[i]} onChange={() => setPicked(picked.map((v, j) => (j === i ? !v : v)))} />}
                  <span className="chip">{a.kind}</span>{' '}
                  {a.kind === 'set-project' ? <>File under <ProjectSelect projects={projects} all={vault.projects} value={a.project ?? ''} onChange={(project) => refile(a.project, project)} /></>
                    : a.kind === 'create-task' ? <>New task <input aria-label="Task title" value={a.title ?? ''} onChange={(e) => edit(i, { title: e.target.value })} /> {a.priority} {a.project ? `in ${a.project}` : ''}</>
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
