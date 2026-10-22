// Calendar: events from private ICS feeds (e.g. Google's "secret address in iCal format", one per account),
// stored in state/calendars.json (gitignored: the URLs are secrets) and cached for 5 minutes.
import fs from 'node:fs'
import path from 'node:path'
import ical, { type CalendarResponse, type VEvent } from 'node-ical'
import { ROOT } from '../lib/vault.mjs'

const FILE = path.join(ROOT, 'state', 'calendars.json')
const TTL_MS = 5 * 60 * 1000
// Parsed feeds, per URL: downloading and parsing is the slow part (seconds); expanding a date range is fast.
// Keyed by URL, not by range, so My day (one day) and the Calendar (six weeks) share the same download.
const parsed = new Map<string, { at: number; data: Promise<CalendarResponse> }>()
function feedData(url: string) {
  const hit = parsed.get(url)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data
  const data = ical.async.fromURL(url)
  parsed.set(url, { at: Date.now(), data })
  data.catch(() => parsed.delete(url)) // don't cache failures
  return data
}

// Fetches all feeds in the background, so the first page that needs them doesn't wait.
export const warmCalendars = () => feeds().forEach((f) => feedData(f.url).catch(() => {}))

export type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string; calendar: number; label: string }
type Feed = { label: string; url: string }

function feeds(): Feed[] {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] }
}

function saveFeeds(list: Feed[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), { mode: 0o600 })
  parsed.clear()
}

// The browser only ever sees labels and hosts, never the secret part of a URL.
export const listFeeds = () => feeds().map((f, i) => ({ index: i, label: f.label, host: new URL(f.url).host }))

export async function addFeed(label: string, url: string) {
  const u = new URL(String(url).trim().replace(/^webcal:/, 'https:'))
  if (u.protocol !== 'https:') throw new Error('the address must start with https://')
  await ical.async.fromURL(u.toString()) // fails early on a wrong or private address
  saveFeeds([...feeds(), { label: String(label).trim() || u.host, url: u.toString() }])
}

export function removeFeed(index: number) {
  saveFeeds(feeds().filter((_, i) => i !== index))
}

export async function events(from: Date, to: Date) {
  const list = feeds()
  if (!list.length) return { events: [], error: 'No calendar connected yet: click "Calendars" to add your Google calendars.' }

  const out: CalEvent[] = []
  const errors: string[] = []
  await Promise.all(list.map(async ({ url, label }, calendar) => {
    try {
      const data = await feedData(url)
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
            label,
          })
        }
      }
    } catch (e: any) {
      errors.push(`${label}: ${e.message}`)
    }
  }))
  return { events: out.sort((a, b) => a.start.localeCompare(b.start)), error: errors.join('; ') }
}
