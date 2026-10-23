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
