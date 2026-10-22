// Calendar: events from private ICS feeds (CALENDAR_ICS in .env.local, comma-separated),
// cached for 5 minutes. Meeting notes and due dates are merged in on the client.
import ical, { type VEvent } from 'node-ical'

const TTL_MS = 5 * 60 * 1000
let cache: { at: number; key: string; events: CalEvent[]; error: string } | undefined

export type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string; calendar: number }

export async function events(from: Date, to: Date) {
  const urls = (process.env.CALENDAR_ICS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!urls.length) return { events: [], error: 'No calendar feed yet: add CALENDAR_ICS to .env.local (see the Guide).' }
  const key = `${from.toISOString()}|${to.toISOString()}`
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache

  const out: CalEvent[] = []
  const errors: string[] = []
  await Promise.all(urls.map(async (url, calendar) => {
    try {
      const data = await ical.async.fromURL(url)
      for (const ev of Object.values(data)) {
        if (ev?.type !== 'VEVENT') continue
        for (const i of ical.expandRecurringEvent(ev as VEvent, { from, to })) {
          out.push({
            id: `${(ev as VEvent).uid}-${new Date(i.start).toISOString()}`,
            title: String(i.summary ?? (ev as VEvent).summary ?? ''),
            start: new Date(i.start).toISOString(),
            end: new Date(i.end ?? i.start).toISOString(),
            allDay: Boolean(i.isFullDay),
            location: String((ev as VEvent).location ?? ''),
            calendar,
          })
        }
      }
    } catch (e: any) {
      errors.push(`feed ${calendar + 1}: ${e.message}`)
    }
  }))
  cache = { at: Date.now(), key, events: out.sort((a, b) => a.start.localeCompare(b.start)), error: errors.join('; ') }
  return cache
}
