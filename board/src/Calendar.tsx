import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { IconButton } from './ui'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { api, unlink, type Doc, type Vault } from './lib'
import { blocks, daysOf, heading, step, VIEWS, type CalView } from './calendarView'

type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string; calendar: number; label: string }
type Feed = { index: number; label: string; host: string }
// From a calendar event (title known) or an empty day (you type the title).
type Picked = { title: string; date: string; time: string; free?: boolean }

const iso = (d: Date) => d.toLocaleDateString('sv')
const clock = (s: string) => new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const MONTH_ITEMS = 3 // per day in the month view; more folds into "+N more", which opens the day
const HOUR = 48 // px per hour on the week and day grid
const FIRST_HOUR = 7 // the hour grid opens just above it; earlier hours are a scroll up

// Like Notion's meeting-notes calendar: events, meeting notes and due tasks per day, by month, week or day.
export default function Calendar({ vault, tasks, open, write, prep, meetingNote, fail }: {
  vault: Vault; tasks: Doc[]; open: (d: Doc) => void; write: (p: string) => void
  prep: (title: string, date: string, prefix?: string) => void; meetingNote: (title: string, date: string, time?: string) => void; fail: (e: Error) => void
}) {
  const [view, setView] = useState<CalView>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Picked>()
  const [feedsOpen, setFeedsOpen] = useState(false)
  const [reload, setReload] = useState(0)

  const days = daysOf(view, anchor)

  useEffect(() => {
    const to = new Date(days[days.length - 1]); to.setDate(to.getDate() + 1)
    let live = true // switching fast: only the last range's answer lands
    setLoading(true)
    api(`calendar?from=${days[0].toISOString()}&to=${to.toISOString()}`)
      .then((r) => { if (live) { setEvents(r.events); setError(r.error) } }, fail)
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [iso(days[0]), view, reload]) // the first day and the view fix the range; a new anchor inside it doesn't refetch

  const today = iso(new Date())
  const openDay = (d: Date) => { setView('day'); setAnchor(d) }
  const pickFree = (date: string, time = '') => setPicked({ title: '', date, time, free: true })
  // A click on the cell itself (or its date), not on one of its items.
  const onEmpty = (date: string) => (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('cal-num')) pickFree(date)
  }

  const eventItem = (e: CalEvent, date: string, style?: CSSProperties) => (
    <button key={e.id} className={`cal-item event cal-${e.calendar % 4}`} style={style} title={`${e.title} (${e.label})`}
      onClick={() => setPicked({ title: e.title, date, time: e.allDay ? 'all day' : clock(e.start) })}>
      <span>{!e.allDay && <span className="time">{clock(e.start)}</span>} {e.title}</span>
    </button>
  )
  // Meeting notes and due tasks have no length, so they sit with the all-day events.
  const undated = (date: string) => [
    ...vault.meetings.filter((m) => String(m.data.date) === date).map((m) => (
      <button key={m.name} className="cal-item note" title={m.name} onClick={() => write(`meetings/${m.name}.md`)}>
        🗒 {m.name.replace(/^\d{4}-\d{2}-\d{2} /, '')}
      </button>
    )),
    ...tasks.filter((t) => t.data.due === date && t.data.status !== 'done').map((t) => (
      <button key={t.name} className={`cal-item task ${t.data.priority}`} title={t.data.title} onClick={() => open(t)}>
        ☐ {t.data.title}
      </button>
    )),
  ]

  return (
    <main className="calendar">
      <div className="cal-head">
        <h2>{heading(view, anchor)}</h2>
        <div className="spacer" />
        <div className="view-switch" role="group" aria-label="Show">
          {VIEWS.map((v) => <button key={v} className={v === view ? 'tab on' : 'tab'} aria-pressed={v === view} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
        </div>
        <button onClick={() => setFeedsOpen(true)}>Calendars</button>
        <IconButton icon={ChevronLeft} label={`Previous ${view}`} onClick={() => setAnchor((a) => step(view, a, -1))} />
        <button onClick={() => setAnchor(new Date())}>Today</button>
        <IconButton icon={ChevronRight} label={`Next ${view}`} onClick={() => setAnchor((a) => step(view, a, 1))} />
      </div>
      {loading && <p className="muted">Loading your calendars…</p>}
      {error && <p className="muted">{error}</p>}
      {view === 'month'
        ? <div className="cal-grid">
            {days.slice(0, 7).map((d) => <div key={d.getDay()} className="cal-dow">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</div>)}
            {days.map((d) => {
              const key = iso(d)
              const items = [...events.filter((e) => iso(new Date(e.start)) === key).map((e) => eventItem(e, key)), ...undated(key)]
              const shown = items.length > MONTH_ITEMS ? items.slice(0, MONTH_ITEMS - 1) : items
              return (
                <div key={key} title="Click an empty spot to add a meeting note or task" onClick={onEmpty(key)} className={`cal-day ${d.getMonth() !== anchor.getMonth() ? 'other' : ''} ${key === today ? 'is-today' : ''}`}>
                  <div className="cal-num">{d.getDate()}</div>
                  {shown}
                  {shown.length < items.length && <button className="cal-more" onClick={() => openDay(d)}>+{items.length - shown.length} more</button>}
                </div>
              )
            })}
          </div>
        : <Hours days={days} today={today} openDay={view === 'week' ? openDay : undefined} pickFree={pickFree} onEmpty={onEmpty}
            allDay={(key) => [...events.filter((e) => e.allDay && iso(new Date(e.start)) === key).map((e) => eventItem(e, key)), ...undated(key)]}
            timed={(d) => blocks(events.filter((e) => !e.allDay), d).map((b) => eventItem(b.item, iso(d), {
              top: b.top / 60 * HOUR, height: b.height / 60 * HOUR,
              left: `${b.lane / b.lanes * 100}%`, width: `${100 / b.lanes}%`,
            }))} />}
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

// Week and day: a gutter of hours with each day's timed events placed on it, and the rest of the day above.
function Hours({ days, today, openDay, pickFree, onEmpty, allDay, timed }: {
  days: Date[]; today: string; openDay?: (d: Date) => void; pickFree: (date: string, time?: string) => void
  onEmpty: (date: string) => (e: React.MouseEvent) => void; allDay: (date: string) => ReactNode[]; timed: (d: Date) => ReactNode[]
}) {
  const body = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { body.current?.scrollTo({ top: FIRST_HOUR * HOUR - HOUR / 2 }) }, [])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  // An empty spot on the grid: a note or task at that half hour.
  const pickAt = (date: string) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const half = Math.floor((e.nativeEvent.offsetY / HOUR) * 2)
    pickFree(date, `${String(Math.floor(half / 2)).padStart(2, '0')}:${half % 2 ? '30' : '00'}`)
  }
  const style = { '--days': days.length, '--hour': `${HOUR}px` } as CSSProperties
  return (
    <div className="cal-time" style={style}>
      <div className="cal-time-head">
        <div className="cal-gutter" />
        {days.map((d) => (
          <div key={iso(d)} className={`cal-dow ${iso(d) === today ? 'is-today' : ''}`}>
            {openDay
              ? <button className="link" title="Show this day" onClick={() => openDay(d)}>{d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</button>
              : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
          </div>
        ))}
        <div className="cal-gutter muted">all day</div>
        {days.map((d) => <div key={iso(d)} className="cal-day cal-allday" title="Click an empty spot to add a meeting note or task" onClick={onEmpty(iso(d))}>{allDay(iso(d))}</div>)}
      </div>
      <div className="cal-time-body" ref={body}>
        <div className="cal-gutter">
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="cal-hour">{h ? `${String(h).padStart(2, '0')}:00` : ''}</div>)}
        </div>
        {days.map((d) => (
          <div key={iso(d)} className={`cal-col ${iso(d) === today ? 'is-today' : ''}`} title="Click an empty spot to add a meeting note or task" onClick={pickAt(iso(d))}>
            {timed(d)}
            {iso(d) === iso(now) && <div className="cal-now" style={{ top: (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// Connected calendars: one secret iCal address per Google account.
export function Feeds({ close, fail }: { close: () => void; fail: (e: Error) => void }) {
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
