import { arrayMove } from '@dnd-kit/sortable'

// Card ids per column while a drag is going on: the board renders from this, so a card shows its new
// place before you drop it. Only the drop writes anything.
export type Layout = Record<string, string[]>
export type Move = { id: string; status: string; order: number }

const COL = 'col:'
// The last place a card is still shown in a column of `length` cards (My day shows only `limit`).
const lastShown = (length: number, limit?: number) => Math.min(length, limit ?? length) - 1

const columnFor = (layout: Layout, id: string) =>
  id.startsWith(COL) ? id.slice(COL.length) : Object.keys(layout).find((s) => layout[s].includes(id))

// Where a drag aims, given what the pointer hit. Only at cards starred like the dragged one: starred cards
// sit on top, so the card can't go among the others. Over a column, at its nearest such card. Over nothing
// right after the card changed column, at the card itself until the layout has caught up, or the card
// flips between two columns at their edge (dnd-kit's multiple-containers recipe). Over nothing otherwise,
// at nothing: letting go off the board cancels the drag.
export type Sticky = { justMoved: boolean; active: string }
export function aim(hit: string | undefined, layout: Layout, nearest: (cards: Set<string>) => string | undefined, sticky: Sticky, starred: (id: string) => boolean) {
  if (hit === undefined) return sticky.justMoved ? sticky.active : undefined
  const mine = starred(sticky.active)
  const col = hit.startsWith(COL) ? hit.slice(COL.length) : starred(hit) === mine ? undefined : columnFor(layout, hit)
  if (col === undefined) return hit
  const cards = new Set((layout[col] ?? []).filter((x) => starred(x) === mine))
  return (cards.size ? nearest(cards) : undefined) ?? `${COL}${col}`
}

// Dragging over another column moves the card into it, before the card it's over, or last of the cards
// shown when it's over the column itself. From there the sortable list moves it within the column. It
// doesn't go past the cards shown, or it would vanish mid-drag on My day, but staying with the cards
// starred like it (starred ones sit on top) comes first, as that's where the drop puts it. Done sorts by
// when a task was finished, so there it goes where `doneAt` says, as far as it's shown.
// Same layout back when nothing changes, or for the unknown-status column, which a drop can't move to.
export function dragOver(layout: Layout, id: string, over: string, limit?: number, starred: (id: string) => boolean = () => false,
  doneAt: (target: string[], id: string) => number = () => 0): Layout {
  const from = columnFor(layout, id)
  const to = columnFor(layout, over)
  if (!from || !to || from === to || to === '?') return layout
  const target = layout[to]
  const i = target.indexOf(over)
  const stars = target.filter(starred).length
  const [lo, hi] = starred(id) ? [0, stars] : [stars, target.length]
  const shown = Math.min(i >= 0 ? i : Infinity, lastShown(target.length + 1, limit))
  const at = to === 'done' ? Math.min(doneAt(target, id), lastShown(target.length + 1, limit)) : Math.min(Math.max(shown, lo), hi)
  return { ...layout, [from]: layout[from].filter((x) => x !== id), [to]: [...target.slice(0, at), id, ...target.slice(at)] }
}

// The preview `now` carried over onto a reloaded layout `fresh`: the columns as they are now, with the
// dragged card where the preview had it, after the same card as before (or first, if that card left).
// A card still in its `home` column (where the drag began) takes its place in `fresh`, so a status
// changed elsewhere meanwhile isn't undone; a card gone from `fresh` stays gone, so the drop does nothing.
// Same `now` back when nothing it shows changed, so a reload that changed nothing moves nothing.
export function rebase(now: Layout, fresh: Layout, id: string, home: string): Layout {
  const col = columnFor(now, id)
  const same = (l: Layout) => Object.keys(l).length === Object.keys(now).length && Object.keys(l).every((c) => l[c].join() === now[c]?.join())
  if (!col || col === home || !fresh[col] || !columnFor(fresh, id)) return same(fresh) ? now : fresh
  const rest = (c: string) => fresh[c].filter((x) => x !== id)
  const shown = now[col]
  const after = shown.slice(0, shown.indexOf(id)).reverse().find((x) => rest(col).includes(x))
  const target = rest(col)
  const at = after === undefined ? 0 : target.indexOf(after) + 1
  const next: Layout = Object.fromEntries(Object.keys(fresh).map((c) => [c, c === col ? [...target.slice(0, at), id, ...target.slice(at)] : rest(c)]))
  return same(next) ? now : next
}

// When the board may scroll an area while a card is dragged: only once the card has travelled TRAVEL_PX
// from where it was picked up (from then on, for the rest of the drag), and only an area the pointer is
// level with: across a column for its vertical scroll, along the board for its sideways scroll. Past the
// edge in the scroll direction is fine; that's how you ask for more. dnd-kit scrolls any area whose edge
// the pointer nears, also from beside it, so a card picked up low in a long column, or carried on to the
// next one, set that column's cards moving under the pointer.
export const TRAVEL_PX = 40
type Point = { x: number; y: number }
type Rect = { left: number; right: number; top: number; bottom: number }
export function dragScroll(start: Point) {
  let now = start
  let travelled = false
  return {
    move(p: Point) {
      now = p
      travelled ||= Math.hypot(p.x - start.x, p.y - start.y) > TRAVEL_PX
    },
    may(area: Rect, scrolls: { x: boolean; y: boolean }) {
      const levelX = now.x >= area.left && now.x <= area.right
      const levelY = now.y >= area.top && now.y <= area.bottom
      return travelled && (!scrolls.y || levelX) && (!scrolls.x || levelY)
    },
  }
}

// Orders are spaced out by STEP and stay positive whole numbers; 0 is where new tasks start, at the top.
const STEP = 10

// The writes for a drop, from the layout `before` the drag and the previewed one `now`. The card takes an
// order between its new neighbours, so a drop is one write. Only when there's no room is the column
// renumbered, minus the cards that are already right. Done sorts by when a task was finished, so only the
// card itself moves there.
export function dropMoves(before: Layout, now: Layout, id: string, over: string, current: (id: string) => { status?: unknown; order?: unknown }, limit?: number, starred: (id: string) => boolean = () => false): Move[] {
  const to = columnFor(now, id)
  if (!to || to === '?') return []
  if (to === 'done') return current(id).status === 'done' ? [] : [{ id, status: to, order: 0 }]
  const col = now[to]
  const i = over.startsWith(COL) ? lastShown(col.length, limit) : col.indexOf(over)
  const moved = i >= 0 ? arrayMove(col, col.indexOf(id), i) : col
  if (moved.join() === before[to]?.join()) return []
  // Starred cards sit on top whatever their order, so the card is placed among the cards starred like it.
  // Only cards still in that column: one can have moved, or gone, during the drag.
  const ids = moved.filter((x) => starred(x) === starred(id) && (x === id || current(x).status === to))
  const order = (x?: string) => (x === undefined ? undefined : Number(current(x).order) || 0)
  const at = ids.indexOf(id)
  const [prev, next] = [order(ids[at - 1]), order(ids[at + 1])]
  const fits = (o: number) => Number.isInteger(o) && o > (prev ?? 0) && (next === undefined || o < next)
  const own = order(id)!
  const fit = [own, next === undefined ? (prev ?? 0) + STEP : Math.floor(((prev ?? 0) + next) / 2)].find(fits)
  // Moved only across starred cards, which sort on their own: nothing to write.
  if (fit === own && current(id).status === to) return []
  if (fit !== undefined) return [{ id, status: to, order: fit }]
  return ids.map((x, n) => ({ id: x, status: to, order: (n + 1) * STEP }))
    .filter((m) => current(m.id).status !== m.status || Number(current(m.id).order) !== m.order)
}
