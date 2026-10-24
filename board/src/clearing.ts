// Thoughts as the clearing: unfiled thoughts are saplings in a clearing, filed ones trees in their project's woods.
// The layout and the search for the Thoughts page (Notes.tsx), kept apart so they can be tested.
import { list, noteTitle, unlink, type Doc } from './lib'

export type Note = { path: string; name: string; data: Record<string, any>; mtime: string; excerpt: string }

export const isMeeting = (n: Note) => n.path.startsWith('meetings/')
// Waiting to take root: a thought the agent hasn't filed yet. Same test as the Brain Terrain map.
export const waiting = (n: Note) => !isMeeting(n) && n.data.status === 'inbox'
export const taskIds = (n: Note) => list(n.data.tasks).map(unlink).filter(Boolean)

// A note matches when each word of the query is in its title, first line or linked task ids.
export function matchesNote(n: Note, query: string) {
  const text = `${noteTitle(n.name).title} ${n.excerpt} ${taskIds(n).join(' ')}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).every((w) => text.includes(w))
}

// When a thought was planted: the time in its file name ("2026-10-23 1622 …"), else when it was last saved.
export function plantedAt(n: Note) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2})(\d{2}))?/.exec(n.name)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)) : new Date(n.mtime)
}
const byNewest = (a: Note, b: Note) => plantedAt(b).getTime() - plantedAt(a).getTime()

export const thisWeek = (n: Note, now = new Date()) => now.getTime() - plantedAt(n).getTime() < 7 * 864e5

// A short time label: 16:22 today, Thu 11:26 this week, 12 Oct before that.
export function shortWhen(n: Note, now = new Date()) {
  const d = plantedAt(n)
  // A meeting named by its day only has no time worth showing.
  const dayOnly = /^\d{4}-\d{2}-\d{2}(?! \d{4}\b)/.test(n.name)
  const time = dayOnly ? '' : d.toTimeString().slice(0, 5)
  if (d.toDateString() === now.toDateString()) return time || 'Today'
  if (thisWeek(n, now)) return [d.toLocaleDateString('en-GB', { weekday: 'short' }), time].filter(Boolean).join(' ')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// The project a filed thought grew on: its own, else the one of the first task it is linked to.
export function hillOf(n: Note, tasks: Doc[]) {
  const own = unlink(n.data.project)
  if (own) return own
  const ids = taskIds(n)
  return unlink(tasks.find((t) => ids.includes(t.name))?.data.project)
}

export const W = 1100
export const H = 280
export const CLEARING = { x: W / 2, y: 200 }
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

export type Place = { path: string; x: number; y: number }
export type Wood = { project: string; x: number; y: number; r: number; trees: Place[] }
export type Clearing = { saplings: Place[]; newest?: string; rx: number; ry: number; woods: Wood[] }

// n points spread evenly over an ellipse (a sunflower), the first in the middle. Deterministic, so nothing moves between visits.
const spread = (n: number, cx: number, cy: number, rx: number, ry: number) => Array.from({ length: n }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / n)
  return { x: cx + Math.cos(i * GOLDEN) * r * rx, y: cy + Math.sin(i * GOLDEN) * r * ry }
})

// The survey sheet on the Thoughts page, in a W x H viewBox: the clearing in the middle at the bottom,
// the project hills to its right and left, biggest first, with one tree per filed thought in the woods at their foot.
export function clearingOf(notes: Note[], tasks: Doc[]): Clearing {
  const saplings = notes.filter(waiting).sort(byNewest)
  const rx = Math.min(150, 70 + 14 * Math.sqrt(saplings.length))
  const ry = rx * 0.32
  const at = spread(saplings.length, CLEARING.x, CLEARING.y, rx - 14, ry - 8)

  const groups = new Map<string, Note[]>()
  for (const n of notes.filter((x) => !isMeeting(x) && !waiting(x)).sort(byNewest)) {
    const p = hillOf(n, tasks)
    groups.set(p, [...(groups.get(p) ?? []), n])
  }
  const hills = [...groups].sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
  // Every other hill goes to the right, then the left; each side shares the room beside the clearing.
  const side = (i: number) => (i % 2 ? -1 : 1)
  const perSide = Math.ceil(hills.length / 2)
  const room = W / 2 - rx - 40
  const slot = room / Math.max(perSide, 1)
  const woods = hills.map(([project, trees], i) => {
    const k = Math.floor(i / 2)
    const r = Math.min(110, slot * 0.45, 46 + 10 * Math.sqrt(trees.length))
    const x = CLEARING.x + side(i) * (rx + 20 + slot * (k + 0.5))
    const y = 120 + (k % 2 ? 14 : 0)
    // The woods sit at the foot of the hill, on the side away from the clearing.
    const wood = spread(trees.length, x + side(i) * r * 0.3, y + r * 0.35, Math.min(r * 0.6, 8 + 7 * Math.sqrt(trees.length)), Math.min(r * 0.45, 6 + 5 * Math.sqrt(trees.length)))
    return { project, x, y, r, trees: trees.map((n, j) => ({ path: n.path, ...wood[j] })) }
  })
  return { saplings: saplings.map((n, i) => ({ path: n.path, ...at[i] })), newest: saplings[0]?.path, rx, ry, woods }
}
