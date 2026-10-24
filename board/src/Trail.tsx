import { Check, ListPlus, Mountain, NotebookText, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Fold, IconButton, useEscape } from './ui'
import { LABELS, URGENT, columnOf, hillRings, prioLabel, unlink, urgency, type Doc } from './lib'
import {
  WAY_KINDS, cairnMarks, duration, goalOf, hhmm, isDone, plural, projectName, wayTitle,
  type CalEvent, type Cairn, type Span, type Stretch, type Way,
} from './day'

export type Meeting = Span & { event?: CalEvent; note?: Doc; title: string }
// The trail as Terrain draws it: a path that winds a few pixels around the line, so it reads as walked, not ruled.
const WIND = 'M0 137 C80 131 170 131 250 137 S420 143 500 137 S670 131 750 137 S920 143 1000 137'
const KIND_LABEL: Record<Way['kind'], string> = { deep: 'Deep', light: 'Light', rest: 'Rest' }

// The status marker of a task: base camp, climbing, on the ridge, rockfall, summit.
export const Marker = ({ t }: { t: Doc }) => <span className={`marker ${columnOf(t)}`} role="img" aria-label={LABELS[columnOf(t)]} />

// My day as a line from morning to evening. Meetings are fixed pills on it, open stretches dashed cards under it,
// cairns sit on it at their time or right after their meeting. Left of now is walked (solid), the rest still ahead.
export function Trail({ span, now, meetings, stretches, ways, cairns, log, tasks, projects, openMeeting, prep, choose }: {
  span: Span; now: number; meetings: Meeting[]; stretches: Stretch[]; ways: Record<string, Way>
  cairns: Cairn[]; log: Record<string, unknown>; tasks: Doc[]; projects: Doc[]
  openMeeting: (m: Meeting) => void; prep: (title: string) => void; choose: (s: Stretch) => void
}) {
  const x = (m: number) => `${((Math.min(Math.max(m, span.start), span.end) - span.start) / (span.end - span.start)) * 100}%`
  const w = (s: Span) => `${((Math.min(s.end, span.end) - Math.max(s.start, span.start)) / (span.end - span.start)) * 100}%`
  const hours = Array.from({ length: (span.end - span.start) / 60 + 1 }, (_, i) => span.start + i * 60).filter((h, i, all) => all.length <= 12 || i % 2 === 0)
  const timed = meetings.filter((m) => m.event)
  const nowOn = now >= span.start && now <= span.end
  const clip = useId()
  const walked = (Math.min(Math.max(now, span.start), span.end) - span.start) / (span.end - span.start)
  // Overlapping meetings get their own lane: the first on the line, the others below it, where no stretch can be.
  const ends: number[] = []
  const lane = meetings.map((m) => {
    const free = ends.findIndex((e) => e <= m.start)
    const i = free < 0 ? ends.length : free
    ends[i] = m.end
    return Math.min(i, 2)
  })
  // Folded, the trail says where you are.
  const inMeeting = meetings.find((m) => m.start <= now && now < m.end)
  const inStretch = stretches.find((s) => s.start <= now && now < s.end)
  const where = inMeeting ? `Now in ${inMeeting.title}` : inStretch ? `Now on ${wayTitle(ways[hhmm(inStretch.start)], tasks, projects) || 'an open stretch'}` : ''
  const summary = [where, plural(timed.length, 'meeting'), plural(stretches.length, 'open stretch', 'open stretches')].filter(Boolean).join(' · ')
  return (
    <Fold id="trail" className="trail-section" title="Your trail" summary={summary}
      extra={<span className="muted hint-inline">Meetings are fixed. Open stretches are yours to choose.</span>}>
      <div className="trail-card">
        <div className="trail" aria-label={`Your day from ${hhmm(span.start)} to ${hhmm(span.end)}`}>
          <div className="trail-line" />
          {now > span.start && <div className="trail-walked" style={{ width: x(now) }} />}
          <svg className="trail-terrain" viewBox="0 0 1200 290" preserveAspectRatio="xMidYMid slice" aria-hidden>
            <path d="M-20 250C180 214 380 268 600 236S980 200 1220 240" />
            <path d="M-20 274C200 240 400 290 620 260S1000 228 1220 266" strokeDasharray="6 5" />
            <path d="M-20 40C160 10 300 70 470 34S760 0 900 24" />
            <g transform="translate(1080 70)"><ellipse rx="92" ry="46" /><ellipse rx="62" ry="30" /><ellipse rx="32" ry="15" /></g>
            <g transform="translate(140 150)"><ellipse rx="70" ry="30" strokeDasharray="6 5" /><ellipse rx="38" ry="16" /></g>
          </svg>
          <svg className="trail-path" viewBox="0 0 1000 286" preserveAspectRatio="none" aria-hidden>
            <clipPath id={clip}><rect width={walked * 1000} height="286" /></clipPath>
            <path className="ahead" d={WIND} />
            <path className="walked" d={WIND} clipPath={`url(#${clip})`} />
          </svg>
          {nowOn && <><div className="trail-now" style={{ left: x(now) }} /><div className="trail-now-label" style={{ left: x(now) }}>Now {hhmm(now)}</div></>}

          {meetings.map((m, i) => (
            <div key={m.event?.id ?? m.note?.name ?? m.title} className={`trail-meeting clickable lane-${lane[i]} ${m.event ? '' : 'note-only'}`}
              style={{ left: x(m.start), width: w(m) }} role="button" tabIndex={0} title={`${hhmm(m.start)} ${m.title}\n${m.note ? 'Open meeting notes' : 'Start meeting notes'}`}
              onClick={() => openMeeting(m)} onKeyDown={(k) => k.key === 'Enter' && openMeeting(m)}>
              <span className="time">{hhmm(m.start)}{m.note && <NotebookText size={12} strokeWidth={1.8} className="note-mark" aria-label="Has notes" />}</span>
              <span className="trail-meeting-title">{m.title}</span>
              {m.event && <span className="hover-actions"><IconButton icon={ListPlus} label="Add a prep todo" stop onClick={() => prep(m.title)} /></span>}
            </div>
          ))}

          {stretches.map((s) => {
            const way = ways[hhmm(s.start)]
            const task = way?.task ? tasks.find((t) => t.name === way.task) : undefined
            const here = now >= s.start && now < s.end
            return (
              <button key={s.start} type="button" className={`trail-stretch ${way ? 'chosen' : ''} ${here ? 'here' : ''}`} style={{ left: x(s.start), width: w(s) }}
                onClick={() => choose(s)} title={way ? 'Change your way' : 'Choose your way'}>
                <span className="time">{hhmm(s.start)} – {hhmm(s.end)}{way && ` · ${KIND_LABEL[way.kind]}`}</span>
                {way
                  ? <span className="stretch-way">{task && <Marker t={task} />}<span className="stretch-title">{wayTitle(way, tasks, projects) || KIND_LABEL[way.kind]}</span></span>
                  : <span className="stretch-way"><Mountain size={14} strokeWidth={1.8} aria-hidden /><span className="stretch-title">Choose your way</span></span>}
                {task && <span className="time">{task.name} · {projectName(task, projects)}</span>}
              </button>
            )
          })}

          {cairns.flatMap((c) => {
            const marks = cairnMarks(c, timed)
            const value = log[c.slug]
            if (c.after === 'meeting') {
              const n = value === 'done' ? marks.length : Number(value) || 0
              return marks.map((at, i) => (
                <span key={`${c.slug}-${i}`} className={`trail-cairn small ${i < n ? 'done' : ''}`} style={{ left: `calc(${x(at)} + 12px)` }}
                  role="img" aria-label={`${c.name} after meeting ${i + 1}${i < n ? ': done' : ''}`} title={`${c.name}, after ${timed[i]?.title ?? 'a meeting'}`}>
                  {i < n && <Check size={10} strokeWidth={1.8} aria-hidden />}
                </span>
              ))
            }
            const done = isDone(c, value, goalOf(c, timed.length))
            return marks.map((at) => (
              <span key={c.slug} className="trail-cairn-at" style={{ left: x(at) }}>
                <span className="trail-cairn-label"><span className="time">{hhmm(at)}</span><span>{c.name}</span></span>
                <span className={`trail-cairn ${done ? 'done' : ''}`} role="img" aria-label={`${c.name}${done ? ': done' : ''}`}>
                  {done && <Check size={12} strokeWidth={1.8} aria-hidden />}
                </span>
              </span>
            ))
          })}

          <div className="trail-hours" aria-hidden>
            {hours.map((h) => <span key={h} style={{ left: x(h) }}>{hhmm(h)}</span>)}
          </div>
        </div>
      </div>
      <div className="trail-key">
        <span><i className="k k-cairn" />Cairn at a time</span><span><i className="k k-cairn-after" />Cairn after a meeting</span>
        <span><i className="k k-open" />Open stretch</span><span><i className="k k-walked" />Walked</span>
      </div>
    </Fold>
  )
}

// Concentric rings for a project, from its open work: the same reading as its hill on the map.
function RingChip({ tasks }: { tasks: Doc[] }) {
  const rings = hillRings(tasks.map(columnOf)).slice(0, 3)
  const hot = tasks.some((t) => URGENT.includes(t.data.priority))
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      {rings.map((s, i) => <circle key={i} cx="12" cy="12" r={10 - i * 3.5} className={`ring ${s}`} strokeWidth="1.5" />)}
      <circle cx="12" cy="12" r="2.8" className={`peak ${hot ? 'hot' : ''}`} />
    </svg>
  )
}

// Choose your way for one open stretch: a kind of work, then a task to pick up, one that is due, or a project.
// The block-in-my-calendar option waits: the calendar is a read-only iCal feed.
export function ChooseWay({ stretch, way, tasks, projects, save, close }: {
  stretch: Stretch; way?: Way; tasks: Doc[]; projects: Doc[]
  save: (w: Way | null) => void; close: () => void
}) {
  const [kind, setKind] = useState<Way['kind']>(way?.kind ?? 'deep')
  const [pick, setPick] = useState<{ task?: string; project?: string }>({ task: way?.task, project: way?.project })
  useEscape(close)

  const open = tasks.filter((t) => t.data.status !== 'done')
  const going = open.filter((t) => ['wip', 'review'].includes(t.data.status))
  const due = open.map((t) => ({ t, ...urgency(t) })).filter((x) => !going.includes(x.t) && x.reasons.some((r) => /overdue|due/.test(r)))
    .sort((a, b) => b.score - a.score).slice(0, 5)
  const hills = projects.filter((p) => (p.data.status ?? 'active') === 'active')
  const between = stretch.after && stretch.before ? `Between ${stretch.after} and ${stretch.before}.`
    : stretch.after ? `After ${stretch.after}.` : stretch.before ? `Before ${stretch.before}.` : 'No meetings around it.'
  const row = (t: Doc, meta: string) => {
    const on = pick.task === t.name
    return (
      <button key={t.name} type="button" className={`way-option ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setPick(on ? {} : { task: t.name })}>
        <Marker t={t} />
        <span className="way-text"><span className="way-title">{t.data.title ?? t.name}</span><span className="time">{meta}</span></span>
        {URGENT.includes(t.data.priority) && <span className={`prio ${t.data.priority}`}>{prioLabel(t.data.priority)}</span>}
        {on && <Check size={16} strokeWidth={1.8} aria-label="Selected" />}
      </button>
    )
  }
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="popover choose-way" role="dialog" aria-label="Choose your way">
        <div className="choose-head">
          <div>
            <span className="time eyebrow">Open stretch · {hhmm(stretch.start)} – {hhmm(stretch.end)} · {duration(stretch.end - stretch.start)}</span>
            <h2>Choose your way</h2>
            <p className="muted">{between}</p>
          </div>
          <IconButton icon={X} label="Close" onClick={close} />
        </div>
        <div className="choose-group">
          <span className="eyebrow">Kind of work</span>
          <div className="segmented" role="radiogroup" aria-label="Kind of work">
            {WAY_KINDS.map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
          </div>
        </div>
        {kind !== 'rest' && <>
          {going.length > 0 && <div className="choose-group">
            <span className="eyebrow">Pick up where you left</span>
            {going.map((t) => row(t, `${t.name} · ${projectName(t, projects)} · ${LABELS[t.data.status]}`))}
          </div>}
          {due.length > 0 && <div className="choose-group">
            <span className="eyebrow">Due soon</span>
            {due.map(({ t, reasons }) => row(t, `${t.name} · ${projectName(t, projects)} · ${reasons.find((r) => /overdue|due/.test(r))}`))}
          </div>}
          {hills.length > 0 && <div className="choose-group">
            <span className="eyebrow">Or head for a hill</span>
            <div className="hill-chips">
              {hills.map((p) => {
                const on = pick.project === p.name && !pick.task
                return (
                  <button key={p.name} type="button" className={`hill-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setPick(on ? {} : { project: p.name })}>
                    <RingChip tasks={open.filter((t) => unlink(t.data.project) === p.name)} />{p.data.name ?? p.name}
                  </button>
                )
              })}
            </div>
          </div>}
        </>}
        <div className="row-actions">
          <button type="button" onClick={() => { save(null); close() }}>Leave it open</button>
          <button type="button" className="primary" onClick={() => {
            const task = kind === 'rest' ? undefined : pick.task
            const project = kind === 'rest' ? undefined : pick.project ?? (task ? unlink(tasks.find((t) => t.name === task)?.data.project) : undefined)
            save({ kind, ...(task && { task }), ...(project && { project }) }); close()
          }}>Take this way</button>
        </div>
      </div>
    </>
  )
}
