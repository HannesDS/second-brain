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

// Dragging over another column moves the card into it, next to the card it's over (after it when the
// dragged card is `below` its middle), or last of the cards shown when it's over the column itself. Done lists the latest finished first, so there it goes on top.
// Same layout back when nothing changes, or for the unknown-status column, which a drop can't move to.
export function dragOver(layout: Layout, id: string, over: string, limit?: number, below = false): Layout {
  const from = columnFor(layout, id)
  const to = columnFor(layout, over)
  if (!from || !to || from === to || to === '?') return layout
  const target = layout[to]
  const i = target.indexOf(over)
  const at = to === 'done' ? 0 : i >= 0 ? i + Number(below) : lastShown(target.length + 1, limit)
  return { ...layout, [from]: layout[from].filter((x) => x !== id), [to]: [...target.slice(0, at), id, ...target.slice(at)] }
}

// Orders are spaced out by STEP and stay positive whole numbers; 0 is where new tasks start, at the top.
const STEP = 10

// The writes for a drop, from the layout `before` the drag and the previewed one `now`. The card takes an
// order between its new neighbours, so a drop is one write. Only when there's no room (close orders, or a
// starred card above) is the column renumbered, minus the cards that are already right. Done sorts by when
// a task was finished, so only the card itself moves there.
export function dropMoves(before: Layout, now: Layout, id: string, over: string, current: (id: string) => { status?: unknown; order?: unknown }, limit?: number): Move[] {
  const to = columnFor(now, id)
  if (!to || to === '?') return []
  if (to === 'done') return current(id).status === 'done' ? [] : [{ id, status: to, order: 0 }]
  const col = now[to]
  const i = over.startsWith(COL) ? lastShown(col.length, limit) : col.indexOf(over)
  const ids = i >= 0 ? arrayMove(col, col.indexOf(id), i) : col
  if (ids.join() === before[to]?.join()) return []
  const order = (x?: string) => (x === undefined ? undefined : Number(current(x).order) || 0)
  const at = ids.indexOf(id)
  const [prev, next] = [order(ids[at - 1]), order(ids[at + 1])]
  const fits = (o: number) => Number.isInteger(o) && o > (prev ?? 0) && (next === undefined || o < next)
  const own = order(id)!
  const fit = [own, next === undefined ? (prev ?? 0) + STEP : Math.floor(((prev ?? 0) + next) / 2)].find(fits)
  if (fit !== undefined) return [{ id, status: to, order: fit }]
  return ids.map((x, n) => ({ id: x, status: to, order: (n + 1) * STEP }))
    .filter((m) => current(m.id).status !== m.status || Number(current(m.id).order) !== m.order)
}
