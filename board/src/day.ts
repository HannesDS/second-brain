// My day as a trail: meetings are fixed waypoints, the gaps between them are open stretches you choose a way for.
// Cairns are small habits that come back on a schedule; what you did lives in the day file (vault/days/YYYY-MM-DD.md).
import { unlink, type Doc, type Fields } from './lib'

export type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean; calendar?: number }
// Times on the trail are minutes since midnight.
export type Span = { start: number; end: number }
export type Stretch = Span & { after?: CalEvent; before?: CalEvent }
export type Way = { kind: 'deep' | 'light' | 'rest'; task?: string; project?: string }
export const WAY_KINDS: Way['kind'][] = ['deep', 'light', 'rest']

export const DAY_START = 8 * 60
export const DAY_END = 18 * 60
export const MIN_STRETCH = 30

export const minuteOf = (d: Date) => d.getHours() * 60 + d.getMinutes()
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const length = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}` : `${m} min`)

// Timed meetings of the day, clipped to it: one that started yesterday begins at 00:00.
export function meetingSpans(events: CalEvent[], day: Date): (Span & { event: CalEvent })[] {
  const from = new Date(day); from.setHours(0, 0, 0, 0)
  const to = new Date(from); to.setDate(to.getDate() + 1)
  return events.filter((e) => !e.allDay).map((event) => {
    const s = new Date(event.start); const e = new Date(event.end)
    return { event, start: s < from ? 0 : minuteOf(s), end: e >= to ? 24 * 60 : Math.max(minuteOf(e), minuteOf(s)) }
  }).sort((a, b) => a.start - b.start)
}

// 08:00 to 18:00, widened to the hour when a meeting falls outside.
export function trailSpan(meetings: Span[]): Span {
  const start = Math.min(DAY_START, ...meetings.map((m) => Math.floor(m.start / 60) * 60))
  const end = Math.max(DAY_END, ...meetings.map((m) => Math.ceil(m.end / 60) * 60))
  return { start, end }
}

// Gaps of at least 30 minutes between the meetings, and between them and the ends of the trail.
// Overlapping meetings count as one block.
export function openStretches(meetings: (Span & { event?: CalEvent })[], span: Span, min = MIN_STRETCH): Stretch[] {
  const out: Stretch[] = []
  let at = span.start
  let after: CalEvent | undefined
  for (const m of [...meetings].sort((a, b) => a.start - b.start)) {
    if (m.start - at >= min) out.push({ start: at, end: m.start, after, before: m.event })
    if (m.end >= at) { at = Math.max(at, m.end); after = m.event }
  }
  if (span.end - at >= min) out.push({ start: at, end: span.end, after })
  return out
}

// ---------- Cairns ----------

export type CairnKind = 'check' | 'count' | 'timer'
export const CAIRN_KINDS: CairnKind[] = ['check', 'count', 'timer']
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export type Cairn = {
  slug: string; name: string; kind: CairnKind; target: number; minutes: number
  days: 'daily' | string[]; at: string; after: '' | 'meeting' | 'first-meeting'; context: 'all' | 'dm' | 'personal'; nudge: boolean
}

// A cairn file's frontmatter, with defaults for what is missing or garbled (it may be edited by hand).
export function cairnOf(d: Doc): Cairn {
  const x = d.data
  const kind = CAIRN_KINDS.includes(x.kind) ? x.kind : 'check'
  const days = Array.isArray(x.days) ? x.days.map((s: unknown) => String(s).toLowerCase().slice(0, 3)).filter((s: string) => WEEKDAYS.includes(s)) : 'daily'
  return {
    slug: d.name, name: String(x.name ?? d.name), kind,
    target: Math.max(1, Number(x.target) || 1), minutes: Math.max(1, Number(x.minutes) || 3),
    days: days.length ? days : 'daily', at: /^\d{2}:\d{2}$/.test(String(x.at ?? '')) ? String(x.at) : '',
    after: x.after === 'meeting' || x.after === 'first-meeting' ? x.after : '',
    context: x.context === 'dm' || x.context === 'personal' ? x.context : 'all', nudge: x.nudge === true,
  }
}

// What goes in the file: only the fields its kind and schedule use.
export function cairnData(c: Omit<Cairn, 'slug'>): Fields {
  return {
    name: c.name, kind: c.kind,
    ...(c.kind === 'count' && { target: c.target }), ...(c.kind === 'timer' && { minutes: c.minutes }),
    days: c.days, ...(c.after ? { after: c.after } : c.at ? { at: c.at } : {}), context: c.context, nudge: c.nudge,
  }
}

export const slugOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cairn'

const weekday = (d: Date) => WEEKDAYS[(d.getDay() + 6) % 7]
export const isDue = (c: Cairn, d: Date) => c.days === 'daily' || c.days.includes(weekday(d))

// The context switch: 'dataminded' and 'personal'; a cairn says dm, personal or all.
export const cairnInContext = (context: string, c: Cairn) => !context || c.context === 'all' || (c.context === 'dm' ? 'dataminded' : c.context) === context

// How many ticks make the day: a count's target, one per meeting for "after each meeting", else one.
export const goalOf = (c: Cairn, meetings: number) => (c.after === 'meeting' ? meetings : c.kind === 'count' ? c.target : 1)
// A day's log value: `done`, or how many times. A past day's meeting count is unknown, so any stretch counts there.
export function isDone(c: Cairn, value: unknown, goal: number) {
  if (value === 'done' || value === true) return true
  const n = Number(value) || 0
  return n > 0 && n >= goal
}

const DAY_LABEL: Record<string, string> = { 'mon,tue,wed,thu,fri': 'weekdays', 'sat,sun': 'weekends' }
export function scheduleOf(c: Cairn) {
  const when = c.after === 'meeting' ? 'after each meeting' : c.after === 'first-meeting' ? 'after the first meeting' : c.at
  const days = c.days === 'daily' || c.days.length === 7 ? 'every day' : DAY_LABEL[c.days.join(',')] ?? c.days.join(' ')
  const amount = c.kind === 'count' ? `${c.target} a day` : ''
  return [when || amount, days].filter(Boolean).join(' · ')
}

// The ISO dates of the week `d` is in, Monday first.
export function weekOf(d: Date) {
  const monday = new Date(d); monday.setHours(12, 0, 0, 0); monday.setDate(monday.getDate() - ((d.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(monday); x.setDate(monday.getDate() + i); return x })
}

export type WeekDot = { date: string; label: string; state: 'done' | 'missed' | 'today' | 'today-done' | 'future' | 'off' }
// This week's dots for one cairn: done or missed from the day files, today as a ring, the rest of the week dashed.
export function weekDots(c: Cairn, today: Date, days: Doc[], meetingsToday: number): WeekDot[] {
  const iso = today.toLocaleDateString('sv')
  return weekOf(today).map((d) => {
    const date = d.toLocaleDateString('sv')
    const label = d.toLocaleDateString('en-GB', { weekday: 'short' })
    const value = days.find((x) => x.name === date)?.data.cairns?.[c.slug]
    if (date > iso) return { date, label, state: 'future' }
    if (!isDue(c, d)) return { date, label: `${label}: not on`, state: 'off' }
    if (date === iso) return isDone(c, value, goalOf(c, meetingsToday)) ? { date, label: 'Today: done', state: 'today-done' } : { date, label: 'Today', state: 'today' }
    return isDone(c, value, goalOf(c, 1)) ? { date, label: `${label}: done`, state: 'done' } : { date, label: `${label}: missed`, state: 'missed' }
  })
}

// Where a cairn sits on the trail: at its time, or right after each (or the first) meeting.
export function cairnMarks(c: Cairn, meetings: Span[]): number[] {
  if (c.after === 'meeting') return meetings.map((m) => m.end)
  if (c.after === 'first-meeting') return meetings.length ? [meetings[0].end] : []
  if (!c.at) return []
  const [h, m] = c.at.split(':').map(Number)
  return [h * 60 + m]
}

// What a chosen stretch shows: Rest, the task, else the project.
export const wayTitle = (w: Way | undefined, tasks: Doc[], projects: Doc[]) => {
  if (!w) return ''
  if (w.kind === 'rest') return 'Rest'
  const t = w.task && tasks.find((x) => x.name === w.task)
  if (t) return String(t.data.title ?? t.name)
  const p = w.project && projects.find((x) => x.name === w.project)
  return p ? String(p.data.name ?? p.name) : ''
}
export const projectName = (t: Doc, projects: Doc[]) => {
  const p = projects.find((x) => x.name === unlink(t.data.project))
  return String(p?.data.name ?? unlink(t.data.project))
}
