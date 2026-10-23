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

// Where a drag aims, given what the pointer hit. Over a column, at its nearest card. Over nothing right
// after the card changed column, at the card itself until the layout has caught up; otherwise at the last
// target. Without this the card flips between two columns at their edge (dnd-kit's multiple-containers recipe).
export type Sticky = { last?: string; justMoved: boolean; active: string }
export function aim(hit: string | undefined, layout: Layout, nearest: (cards: Set<string>) => string | undefined, sticky: Sticky) {
  if (hit !== undefined) {
    const cards = hit.startsWith(COL) ? layout[hit.slice(COL.length)] : undefined
    sticky.last = (cards?.length ? nearest(new Set(cards)) : undefined) ?? hit
    return sticky.last
  }
  if (sticky.justMoved) sticky.last = sticky.active
  return sticky.last
}

// Dragging over another column moves the card into it, before the card it's over, or last of the cards
// shown when it's over the column itself. From there the sortable list moves it within the column. It
// never goes past the cards shown, or it would vanish mid-drag on My day. Done lists the latest finished first, so there it goes on top.
// Same layout back when nothing changes, or for the unknown-status column, which a drop can't move to.
export function dragOver(layout: Layout, id: string, over: string, limit?: number): Layout {
  const from = columnFor(layout, id)
  const to = columnFor(layout, over)
  if (!from || !to || from === to || to === '?') return layout
  const target = layout[to]
  const i = target.indexOf(over)
  const at = to === 'done' ? 0 : Math.min(i >= 0 ? i : Infinity, lastShown(target.length + 1, limit))
  return { ...layout, [from]: layout[from].filter((x) => x !== id), [to]: [...target.slice(0, at), id, ...target.slice(at)] }
}

// Orders are spaced out by STEP and stay positive whole numbers; 0 is where new tasks start, at the top.
const STEP = 10

// The writes for a drop, from the layout `before` the drag and the previewed one `now`. The card takes an
// order between its new neighbours, so a drop is one write. Only when there's no room is the column
// renumbered, minus the cards that are already right. Done sorts by when
// a task was finished, so only the card itself moves there.
export function dropMoves(before: Layout, now: Layout, id: string, over: string, current: (id: string) => { status?: unknown; order?: unknown; focus?: unknown }, limit?: number): Move[] {
  const to = columnFor(now, id)
  if (!to || to === '?') return []
  if (to === 'done') return current(id).status === 'done' ? [] : [{ id, status: to, order: 0 }]
  const col = now[to]
  const i = over.startsWith(COL) ? lastShown(col.length, limit) : col.indexOf(over)
  const moved = i >= 0 ? arrayMove(col, col.indexOf(id), i) : col
  if (moved.join() === before[to]?.join()) return []
  // Starred cards sit on top whatever their order, so the card is placed among the cards starred like it.
  const starred = (x: string) => current(x).focus === true
  const ids = moved.filter((x) => starred(x) === starred(id))
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
