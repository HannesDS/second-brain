// Cairns and day files. A cairn is one file in vault/cairns/<slug>.md; what you did on a day, and the way you
// chose for its open stretches, is the frontmatter of vault/days/YYYY-MM-DD.md, so both stay plain markdown.
import fs from 'node:fs'
import path from 'node:path'
import { VAULT, readDoc, writeDoc } from '../lib/vault.mjs'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const CAIRNS = 'cairns'
const DAYS = 'days'

function dayFile(date: string) {
  if (!DATE.test(date)) throw new Error(`invalid date: ${date}`)
  return path.join(VAULT, DAYS, `${date}.md`)
}
function cairnFile(slug: string) {
  if (!SLUG.test(slug)) throw new Error(`invalid cairn: ${slug}`)
  return path.join(VAULT, CAIRNS, `${slug}.md`)
}

// The day files of the last `n` days that exist, today included: enough for a cairn's week.
export function recentDays(n = 7, now = new Date()) {
  return Array.from({ length: n }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - i); return d.toLocaleDateString('sv') })
    .map((date) => ({ date, f: dayFile(date) }))
    .filter(({ f }) => fs.existsSync(f))
    .map(({ date, f }) => ({ name: date, ...readDoc(f) }))
}

export type DayPatch = {
  // A cairn's value for the day (`done` or a count); null clears it.
  cairns?: Record<string, string | number | null>
  // Adds to a count. Sent instead of the new value, so two quick clicks count twice.
  add?: Record<string, number>
  // The way chosen for an open stretch, keyed by its start ("14:00"); null leaves it open again.
  ways?: Record<string, Record<string, string> | null>
}

// Merges into the day's frontmatter; fields and body written by hand stay.
export function updateDay(date: string, patch: DayPatch) {
  const f = dayFile(date)
  const doc = fs.existsSync(f) ? readDoc(f) : { data: {}, body: '' }
  if ('error' in doc && doc.error) throw new Error(`${date}.md has invalid frontmatter: ${doc.error}`)
  const merge = (into: unknown, changes: Record<string, unknown> = {}) => {
    const out: Record<string, unknown> = { ...(into && typeof into === 'object' ? into : {}) }
    for (const [k, v] of Object.entries(changes)) { if (v === null) delete out[k]; else out[k] = v }
    return out
  }
  const cairns = merge(doc.data.cairns, patch.cairns)
  for (const [k, by] of Object.entries(patch.add ?? {})) cairns[k] = Math.max(0, (Number(cairns[k]) || 0) + Number(by))
  const ways = merge(doc.data.ways, patch.ways)
  const data = { ...doc.data, cairns, ways }
  if (!Object.keys(cairns).length) delete data.cairns
  if (!Object.keys(ways).length) delete data.ways
  writeDoc(f, data, doc.body)
  return data
}

// The fields the form owns: it leaves out the ones a cairn doesn't use, so those go on an edit.
const CAIRN_FIELDS = ['name', 'kind', 'target', 'minutes', 'days', 'at', 'after', 'context', 'nudge']

export function saveCairn(slug: string, data: Record<string, unknown>, isNew: boolean) {
  const f = cairnFile(slug)
  if (isNew && fs.existsSync(f)) throw new Error(`a cairn called ${slug} already exists`)
  // Fields and notes added by hand survive an edit.
  const old = fs.existsSync(f) ? readDoc(f) : { data: {}, body: '' }
  if ('error' in old && old.error) throw new Error(`${slug}.md has invalid frontmatter: ${old.error}`)
  const kept = Object.fromEntries(Object.entries(old.data).filter(([k]) => !CAIRN_FIELDS.includes(k)))
  writeDoc(f, { ...data, ...kept }, old.body)
}

export function deleteCairn(slug: string) {
  fs.rmSync(cairnFile(slug), { force: true })
}
