import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { IconButton } from './ui'
import { useEffect, useState } from 'react'
import { api, unlink, type Doc, type Vault } from './lib'

type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string; calendar: number; label: string }
type Feed = { index: number; label: string; host: string }
// From a calendar event (title known) or an empty day (you type the title).
type Picked = { title: string; date: string; time: string; free?: boolean }

const iso = (d: Date) => d.toLocaleDateString('sv')

// Month view like Notion's meeting-notes calendar: events, meeting notes and due tasks per day.
export default function Calendar({ vault, tasks, open, write, prep, meetingNote, fail }: {
  vault: Vault; tasks: Doc[]; open: (d: Doc) => void; write: (p: string) => void
  prep: (title: string, date: string, prefix?: string) => void; meetingNote: (title: string, date: string, time?: string) => void; fail: (e: Error) => void
}) {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d })
  const [events, setEvents] = useState<CalEvent[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Picked>()
  const [feedsOpen, setFeedsOpen] = useState(false)
  const [reload, setReload] = useState(0)

  // Grid from the Monday on/before the 1st, 6 weeks.
  const first = new Date(month)
  first.setDate(1 - ((month.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(first); d.setDate(first.getDate() + i); return d })

  useEffect(() => {
    const to = new Date(days[41]); to.setDate(to.getDate() + 1)
    setLoading(true)
    api(`calendar?from=${days[0].toISOString()}&to=${to.toISOString()}`)
      .then((r) => { setEvents(r.events); setError(r.error) }, fail)
      .finally(() => setLoading(false))
  }, [month, reload])

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1))
  const today = iso(new Date())

  return (
    <main className="calendar">
      <div className="cal-head">
        <h2>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
        <div className="spacer" />
        <button onClick={() => setFeedsOpen(true)}>Calendars</button>
        <IconButton icon={ChevronLeft} label="Previous month" onClick={() => shift(-1)} />
        <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }}>Today</button>
        <IconButton icon={ChevronRight} label="Next month" onClick={() => shift(1)} />
      </div>
      {loading && <p className="muted">Loading your calendars…</p>}
      {error && <p className="muted">{error}</p>}
      <div className="cal-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {days.map((d) => {
          const key = iso(d)
          const evs = events.filter((e) => iso(new Date(e.start)) === key)
          const notes = vault.meetings.filter((m) => String(m.data.date) === key)
          const due = tasks.filter((t) => t.data.due === key && t.data.status !== 'done')
          return (
            <div key={key} title="Click an empty spot to add a meeting note or task" onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('cal-num')) setPicked({ title: '', date: key, time: '', free: true }) }} className={`cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}`}>
              <div className="cal-num">{d.getDate()}</div>
              {evs.map((e) => (
                <button key={e.id} className={`cal-item event cal-${e.calendar % 4}`} title={`${e.title} (${e.label})`}
                  onClick={() => setPicked({ title: e.title, date: key, time: e.allDay ? 'all day' : new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) })}>
                  {!e.allDay && <span className="time">{new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>} {e.title}
                </button>
              ))}
              {notes.map((m) => (
                <button key={m.name} className="cal-item note" title={m.name} onClick={() => write(`meetings/${m.name}.md`)}>
                  🗒 {m.name.replace(/^\d{4}-\d{2}-\d{2} /, '')}
                </button>
              ))}
              {due.map((t) => (
                <button key={t.name} className={`cal-item task ${t.data.priority}`} title={t.data.title} onClick={() => open(t)}>
                  ☐ {t.data.title}
                </button>
              ))}
            </div>
          )
        })}
      </div>
      {feedsOpen && <Feeds close={() => { setFeedsOpen(false); setReload((n) => n + 1) }} fail={fail} />}
      {picked && (
        <>
          <div className="scrim" onClick={() => setPicked(undefined)} />
          <div className="popover" role="dialog" aria-label={picked.title}>
            {picked.free
              ? <input autoFocus placeholder="Meeting or task title" value={picked.title} onChange={(e) => setPicked({ ...picked, title: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && picked.title.trim()) { meetingNote(picked.title, picked.date, picked.time); setPicked(undefined) } }} />
              : <h3>{picked.title}</h3>}
            <p className="muted">{new Date(picked.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}{picked.time ? ` · ${picked.time}` : ''}</p>
            {picked.free && <label className="muted">Time <input type="time" value={picked.time} onChange={(e) => setPicked({ ...picked, time: e.target.value })} /></label>}
            {(() => {
              const note = vault.meetings.find((m) => String(m.data.date) === picked.date && m.name.toLowerCase().endsWith(picked.title.toLowerCase().replace(/[\\/:*?"<>|#^[\]]/g, '').trim()))
              return note ? <p><button className="link" onClick={() => { write(`meetings/${note.name}.md`); setPicked(undefined) }}>🗒 Open the notes for this meeting</button></p> : null
            })()}
            <div className="row-actions">
              <button disabled={!picked.title.trim()} onClick={() => { prep(picked.title, picked.date, picked.free ? '' : undefined); setPicked(undefined) }}>{picked.free ? '+ Task due this day' : '+ Prep todo'}</button>
              <button className="primary" disabled={!picked.title.trim()} onClick={() => { meetingNote(picked.title, picked.date, picked.free ? picked.time : picked.time === 'all day' ? '' : picked.time); setPicked(undefined) }}>Meeting notes</button>
            </div>
          </div>
        </>
      )}
    </main>
  )
}

// Connected calendars: one secret iCal address per Google account.
function Feeds({ close, fail }: { close: () => void; fail: (e: Error) => void }) {
  const [feeds, setFeeds] = useState<Feed[]>([])
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('calendars').then(setFeeds, fail) }, [])
  const add = () => {
    setBusy(true)
    api('calendars', 'POST', { label, url }).then((f) => { setFeeds(f); setLabel(''); setUrl('') }, fail).finally(() => setBusy(false))
  }
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="popover feeds" role="dialog" aria-label="Calendars">
        <h3>Calendars</h3>
        <ul className="feed-list">
          {feeds.map((f) => (
            <li key={f.index}><span className={`swatch cal-${f.index % 4}`} /> {f.label} <span className="muted">{f.host}</span>
              <IconButton icon={X} label={`Remove ${f.label}`} onClick={() => api(`calendars/${f.index}`, 'DELETE').then(setFeeds, fail)} /></li>
          ))}
          {!feeds.length && <li className="muted">None yet.</li>}
        </ul>
        <ol className="muted steps">
          <li>Open <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">Google Calendar settings</a> in that account.</li>
          <li>Left: click the calendar (your name) → <b>Integrate calendar</b>.</li>
          <li>Copy <b>Secret address in iCal format</b> and paste it below. Repeat for your other account.</li>
        </ol>
        <input placeholder="Label, e.g. Work" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="row-actions">
          <button onClick={close}>Done</button>
          <button className="primary" disabled={!url.trim() || busy} onClick={add}>{busy ? 'Checking…' : 'Add calendar'}</button>
        </div>
        <p className="muted">Stored only on this Mac (state/calendars.json, not in git). Refreshes every 5 minutes.</p>
      </div>
    </>
  )
}

// Best guess of the project a meeting title is about, from project ids and names.
export function guessProject(title: string, projects: Doc[]) {
  const t = title.toLowerCase()
  return projects.find((p) => t.includes(p.name.toLowerCase()) || t.includes(String(p.data.name ?? '').toLowerCase()))?.name ?? ''
}

export const projectOf = (t: Doc) => unlink(t.data.project)
