import { useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import { ago, api } from './lib'

type Note = { path: string; name: string; data: Record<string, any>; mtime: string }
type Action = Record<string, string> & { kind: string; reason: string }

// Notes: write freely (saved as you type), then "File it" lets the agent propose where it goes.
export default function Notes({ path, go, fail, flash }: {
  path?: string; go: (path: string) => void; fail: (e: Error) => void; flash: (m: string) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
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
        {notes.map((n) => (
          <button key={n.path} className={n.path === path ? 'proj on' : 'proj'} onClick={() => go(n.path)}>
            <span className={`dot ${n.data.status === 'inbox' ? 'inbox' : 'filed'}`} title={n.data.status ?? ''} />
            <span className="proj-name">{n.name}</span>
            <span className="muted">{ago(n.mtime)}</span>
          </button>
        ))}
      </nav>
      {path ? <Editor key={path} path={path} fail={fail} flash={flash} onFiled={refresh} /> : (
        <section className="pane empty-note">
          <h2>Write first, file later</h2>
          <p>Start a note and just type: findings, thoughts, a first ADR draft. It saves as you go. When you're done, <strong>File it</strong>: the agent proposes a project, tasks, a meeting link, or what to update outside (Notion, an ADR). You tick what you want.</p>
        </section>
      )}
    </main>
  )
}

function Editor({ path, fail, flash, onFiled }: { path: string; fail: (e: Error) => void; flash: (m: string) => void; onFiled: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const [saved, setSaved] = useState('saved')
  const [meta, setMeta] = useState<Record<string, any>>({})
  const [proposal, setProposal] = useState<{ summary: string; actions: Action[] }>()
  const [picked, setPicked] = useState<boolean[]>([])
  const [filing, setFiling] = useState(false)

  useEffect(() => {
    let crepe: Crepe | undefined
    let timer: number
    let alive = true
    api(`doc?path=${encodeURIComponent(path)}`).then(async (doc) => {
      if (!alive || !root.current) return
      setMeta(doc.data)
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
  }, [path])

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
    onFiled()
  }

  const isNote = path.startsWith('inbox/') || path.startsWith('notes/')
  return (
    <section className="pane editor-pane">
      <div className="editor-head">
        <h2>{path.split('/').pop()!.replace(/\.md$/, '')}</h2>
        <span className="muted">{path.split('/')[0]} · {saved}{meta.project ? ` · ${meta.project}` : ''}</span>
        <div className="spacer" />
        {isNote && <button className="primary" disabled={filing} onClick={propose}>{filing ? 'Thinking…' : 'File it'}</button>}
      </div>
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

function describe(a: Action) {
  switch (a.kind) {
    case 'set-project': return <>File under <b>{a.project}</b></>
    case 'new-project': return <>New project <b>{a.projectName || a.project}</b> ({a.context}, {a.account})</>
    case 'create-task': return <>New task <b>{a.title}</b> {a.priority} {a.project ? `in ${a.project}` : ''}</>
    case 'append-to-task': return <>Add to <b>{a.task}</b>: {a.text?.slice(0, 120)}</>
    case 'link-meeting': return <>Link to meeting <b>{a.meeting}</b></>
    case 'external': return <>Update outside: {a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.url}</a> : null} {a.text}</>
    default: return a.title ?? ''
  }
}
