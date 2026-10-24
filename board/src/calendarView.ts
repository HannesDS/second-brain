// Which days the Calendar shows around a day you're looking at (the anchor), per view.
export type CalView = 'month' | 'week' | 'day'
export const VIEWS: CalView[] = ['month', 'week', 'day']

const plus = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const monday = (d: Date) => plus(d, -((d.getDay() + 6) % 7))

// Month: six weeks from the Monday on/before the 1st. Week: Monday to Sunday. Day: just that day.
export function daysOf(view: CalView, anchor: Date) {
  const [first, length] = view === 'month' ? [monday(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), 42]
    : view === 'week' ? [monday(anchor), 7] : [plus(anchor, 0), 1]
  return Array.from({ length }, (_, i) => plus(first, i))
}

// Whether an event shows on a day: it overlaps the day, so one spanning several days shows on each.
// The end is exclusive (an all-day event ends at midnight of the next day); one without length shows on its start.
export function onDay(e: { start: string; end: string }, day: Date) {
  const from = new Date(e.start).getTime(), to = new Date(e.end).getTime()
  const dayStart = day.getTime(), dayEnd = plus(day, 1).getTime()
  return from < dayEnd && (to > dayStart || from >= dayStart)
}

// The anchor `n` months, weeks or days on. A month step lands on the 1st, so 31 January doesn't skip February.
export const step = (view: CalView, anchor: Date, n: number) =>
  view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + n, 1) : plus(anchor, view === 'week' ? 7 * n : n)

export function heading(view: CalView, anchor: Date) {
  if (view === 'month') return anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  if (view === 'day') return anchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const days = daysOf('week', anchor)
  const short = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${short(days[0])} – ${short(days[6])} ${days[6].getFullYear()}`
}

// Timed events of one day as blocks on the hour grid, in minutes from midnight (clock time, so a DST day still
// reads 9:00 at 9:00). Overlapping events split the width: `lane` of `lanes`, per group that overlaps.
export type Block<T> = { item: T; top: number; height: number; lane: number; lanes: number }
const SHORTEST = 15 // minutes: a zero-length event still gets a block you can click
export function blocks<T extends { start: string; end: string }>(items: T[], day: Date): Block<T>[] {
  const from = daysOf('day', day)[0], to = plus(from, 1)
  const clock = (d: Date) => d < from ? 0 : d >= to ? 24 * 60 : d.getHours() * 60 + d.getMinutes()
  const placed = items
    .map((item) => ({ item, s: new Date(item.start), e: new Date(item.end) }))
    .filter(({ s, e }) => s < to && (e > from || s >= from))
    .map(({ item, s, e }) => {
      const top = Math.min(clock(s), 24 * 60 - SHORTEST)
      return { item, top, height: Math.max(clock(e) - top, SHORTEST), lane: 0, lanes: 1 }
    })
    .sort((a, b) => a.top - b.top || b.height - a.height)
  let group: Block<T>[] = [], ends: number[] = [], groupEnd = 0
  const close = () => { group.forEach((b) => { b.lanes = ends.length }); group = []; ends = [] }
  for (const b of placed) {
    if (b.top >= groupEnd) close()
    const free = ends.findIndex((end) => end <= b.top)
    b.lane = free < 0 ? ends.length : free
    ends[b.lane] = b.top + b.height
    group.push(b)
    groupEnd = Math.max(groupEnd, b.top + b.height)
  }
  close()
  return placed
}
