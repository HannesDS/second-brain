import { expect, test } from 'vitest'
import { aim, dragOver, dropMoves, mayScroll, rebase, type Layout } from './drag'

const layout: Layout = { todo: ['A', 'B', 'C'], wip: ['D', 'E'], done: ['F'] }
const data: Record<string, { status: string; order: number }> = {
  A: { status: 'todo', order: 10 }, B: { status: 'todo', order: 20 }, C: { status: 'todo', order: 30 },
  D: { status: 'wip', order: 10 }, E: { status: 'wip', order: 20 }, F: { status: 'done', order: 0 },
}
const current = (id: string) => data[id]
// A drop as the board makes it: from the layout before the drag, onto the previewed one.
const drop = (now: Layout, id: string, over: string, get: (id: string) => { status?: unknown; order?: unknown } = current, limit?: number) => dropMoves(layout, now, id, over, get, limit)

test('dragging over a card in another column previews the card before it', () => {
  expect(dragOver(layout, 'A', 'E')).toEqual({ todo: ['B', 'C'], wip: ['D', 'A', 'E'], done: ['F'] })
})

test('dragging over a column puts the card last of the cards shown', () => {
  expect(dragOver(layout, 'A', 'col:wip').wip).toEqual(['D', 'E', 'A'])
  expect(dragOver(layout, 'D', 'col:todo', 2).todo).toEqual(['A', 'D', 'B', 'C'])
})

test('dragging within a column leaves the layout alone', () => {
  expect(dragOver(layout, 'A', 'C')).toBe(layout)
})

test('Done previews the card on top, where the drop puts it', () => {
  expect(dragOver({ ...layout, done: ['F', 'G'] }, 'A', 'G').done).toEqual(['A', 'F', 'G'])
})

test('the unknown-status column takes no preview', () => {
  const withUnknown = { ...layout, '?': ['X'] }
  expect(dragOver(withUnknown, 'A', 'col:?')).toBe(withUnknown)
})

test('a reorder writes only the card, with an order between its new neighbours', () => {
  expect(drop(layout, 'C', 'B')).toEqual([{ id: 'C', status: 'todo', order: 15 }])
  expect(drop(layout, 'C', 'A')).toEqual([{ id: 'C', status: 'todo', order: 5 }])
})

test('a drop onto its own place writes nothing', () => {
  expect(drop(layout, 'B', 'B')).toEqual([])
})

test('a card dragged out and back to a new place in its column is written', () => {
  // Out to wip, back in over C: the preview has it between B and C, and it's dropped on itself.
  const back = { ...layout, todo: ['B', 'A', 'C'] }
  expect(drop(back, 'A', 'A')).toEqual([{ id: 'A', status: 'todo', order: 25 }])
})

test('a move to another column writes only the card', () => {
  // After the preview the card sits under the pointer, so it's over itself.
  expect(drop(dragOver(layout, 'A', 'E'), 'A', 'A')).toEqual([{ id: 'A', status: 'wip', order: 15 }])
})

test('a card entering a column never goes past the cards shown', () => {
  // My day shows 2 cards: over the 2nd it goes before it, and over the column it goes last of the 2.
  expect(dragOver(layout, 'D', 'C', 2).todo).toEqual(['A', 'D', 'B', 'C'])
  expect(dragOver({ ...layout, wip: ['D', 'E', 'G'] }, 'A', 'col:wip', 2).wip).toEqual(['D', 'A', 'E', 'G'])
})

test('a drop onto the column moves the card last of the cards shown', () => {
  expect(drop(layout, 'A', 'col:todo')).toEqual([{ id: 'A', status: 'todo', order: 40 }])
  expect(drop(layout, 'A', 'col:todo', current, 2)).toEqual([{ id: 'A', status: 'todo', order: 25 }])
})

test('with no room between the neighbours, the column is renumbered with gaps', () => {
  // New tasks all start at 0, the order the board used to write.
  const fresh = () => ({ status: 'todo', order: 0 })
  expect(drop(layout, 'C', 'B', fresh)).toEqual([
    { id: 'A', status: 'todo', order: 10 },
    { id: 'C', status: 'todo', order: 20 },
    { id: 'B', status: 'todo', order: 30 },
  ])
})

test('orders stay positive whole numbers, so new tasks at 0 still start on top', () => {
  const tight = (id: string) => ({ status: 'todo', order: { A: 1, B: 2, C: 3 }[id] })
  const moves = drop(layout, 'C', 'A', tight)
  expect(moves.every((m) => Number.isInteger(m.order) && m.order > 0)).toBe(true)
  expect(moves.map((m) => m.id)).toEqual(['C', 'A', 'B'])
})

test('Done takes only the card itself, and has no order to change', () => {
  expect(drop(dragOver(layout, 'D', 'F'), 'D', 'F')).toEqual([{ id: 'D', status: 'done', order: 0 }])
  expect(dropMoves(layout, { ...layout, done: ['F', 'G'] }, 'F', 'G', (id) => ({ status: 'done', order: id === 'F' ? 0 : 1 }))).toEqual([])
})

test('a card dropped under a starred card is placed among the unstarred cards only', () => {
  // X is starred with a high order; it shows on top all the same.
  const withStar = { ...layout, todo: ['X', 'A', 'B', 'C'] }
  const get = (id: string) => (id === 'X' ? { status: 'todo', order: 90 } : data[id])
  const starred = (id: string) => id === 'X'
  expect(dropMoves(withStar, withStar, 'C', 'A', get, undefined, starred)).toEqual([{ id: 'C', status: 'todo', order: 5 }])
  // Moved above the starred card only: it still shows below it, so nothing changes.
  expect(dropMoves(withStar, withStar, 'A', 'X', get, undefined, starred)).toEqual([])
})

const nobody = () => false

test('over a column the drag aims at its nearest card, an empty column at the column', () => {
  const sticky = { justMoved: false, active: 'A' }
  const nearest = (cards: Set<string>) => [...cards].at(-1)
  expect(aim('col:wip', layout, nearest, sticky, nobody)).toBe('E')
  expect(aim('col:review', { ...layout, review: [] }, nearest, sticky, nobody)).toBe('col:review')
  expect(aim('B', layout, nearest, sticky, nobody)).toBe('B')
})

test('over nothing the drag aims at the card right after it changed column, else at nothing', () => {
  const sticky = { justMoved: true, active: 'A' }
  expect(aim(undefined, layout, () => undefined, sticky, nobody)).toBe('A')
  // Let go off the board: the drag is cancelled.
  sticky.justMoved = false
  expect(aim(undefined, layout, () => undefined, sticky, nobody)).toBeUndefined()
})

test('the drag aims only at cards starred like the dragged one', () => {
  const withStars = { ...layout, wip: ['S1', 'S2', 'D', 'E'] }
  const starred = (id: string) => id.startsWith('S')
  const nearest = (cards: Set<string>) => [...cards][0]
  // Unstarred A over starred S2 aims at the nearest unstarred card instead, so the list never draws it above S2.
  expect(aim('S2', withStars, nearest, { justMoved: false, active: 'A' }, starred)).toBe('D')
  expect(aim('col:wip', withStars, nearest, { justMoved: false, active: 'A' }, starred)).toBe('D')
  // With no such card in the column, at the column itself.
  expect(aim('S1', { ...layout, wip: ['S1'] }, nearest, { justMoved: false, active: 'A' }, starred)).toBe('col:wip')
})

test('a card entering a column stays with the cards starred like it', () => {
  const withStars = { ...layout, wip: ['S1', 'S2', 'D', 'E'] }
  const starred = (id: string) => id.startsWith('S') || id === 'A2'
  // Unstarred A over a starred card goes right after the starred ones, where the drop will put it.
  expect(dragOver(withStars, 'A', 'S2', undefined, starred).wip).toEqual(['S1', 'S2', 'A', 'D', 'E'])
  // A starred card over an unstarred one goes last of the starred ones.
  const withA2 = { ...withStars, todo: ['A2', 'B', 'C'] }
  expect(dragOver(withA2, 'A2', 'E', undefined, starred).wip).toEqual(['S1', 'S2', 'A2', 'D', 'E'])
  // When starred cards fill every place shown, the unstarred card goes below them, out of sight, as the drop will.
  expect(dragOver(withStars, 'A', 'col:wip', 2, starred).wip).toEqual(['S1', 'S2', 'A', 'D', 'E'])
})

test('the drag sees a star changed mid-drag', () => {
  const nearest = (cards: Set<string>) => [...cards][0]
  const sticky = { justMoved: false, active: 'A' }
  expect(aim('col:wip', layout, nearest, sticky, () => false)).toBe('D')
  // D got starred elsewhere: the board hands in a new `starred`, and the same layout is grouped anew.
  expect(aim('col:wip', layout, nearest, sticky, (id) => id === 'D')).toBe('E')
})

test('a renumber leaves alone a card that left the column during the drag', () => {
  // X moved to wip (an agent) while C was dragged; the preview from before still has it in todo.
  const stale = { ...layout, todo: ['A', 'X', 'B', 'C'] }
  const get = (id: string) => (id === 'X' ? { status: 'wip', order: 0 } : { status: 'todo', order: 0 })
  expect(dropMoves(stale, stale, 'C', 'B', get).map((m) => m.id)).not.toContain('X')
})

test('a reload that changed nothing leaves the preview as it is', () => {
  const now = dragOver(layout, 'A', 'E')
  expect(rebase(now, { ...layout, todo: [...layout.todo] }, 'A', 'todo')).toBe(now)
})

test('a reload mid-drag keeps the card where the preview had it, in the columns as they are now', () => {
  // A is previewed in wip after D; meanwhile G was added to wip and B left todo.
  const now = dragOver(layout, 'A', 'E')
  const fresh = { todo: ['A', 'C'], wip: ['D', 'G', 'E'], done: ['F'] }
  expect(rebase(now, fresh, 'A', 'todo')).toEqual({ todo: ['C'], wip: ['D', 'A', 'G', 'E'], done: ['F'] })
  // The card before it left: it goes first.
  expect(rebase(now, { todo: ['A', 'C'], wip: ['E'], done: ['F'] }, 'A', 'todo').wip).toEqual(['A', 'E'])
})

test('a card still in its own column takes its place in the reload, so a status changed meanwhile stays', () => {
  // X was picked up in todo; an agent moved it to wip during the drag.
  const now = { ...layout, todo: ['A', 'X', 'B', 'C'] }
  const fresh = { ...layout, wip: ['X', 'D', 'E'] }
  expect(rebase(now, fresh, 'X', 'todo')).toBe(fresh)
  expect(dropMoves(fresh, fresh, 'X', 'X', () => ({ status: 'wip', order: 0 }))).toEqual([])
})

test('a card deleted during the drag stays gone, and its drop writes nothing', () => {
  const now = dragOver(layout, 'A', 'E')
  const fresh = { ...layout, todo: ['B', 'C'] }
  expect(rebase(now, fresh, 'A', 'todo')).toBe(fresh)
  expect(dropMoves(fresh, fresh, 'A', 'E', () => ({}))).toEqual([])
})

test('a card dragged into Done previews where Done sorts it', () => {
  expect(dragOver({ ...layout, done: ['F', 'G'] }, 'A', 'G', undefined, undefined, (target) => target.indexOf('G')).done).toEqual(['F', 'A', 'G'])
  // On My day, no further down than the cards shown, or it would vanish mid-drag.
  expect(dragOver({ ...layout, done: ['F', 'G', 'H'] }, 'A', 'col:done', 2, undefined, () => 3).done).toEqual(['F', 'A', 'G', 'H'])
})

test('the board scrolls an area only once the card travelled, and only with the pointer over it', () => {
  const column = { left: 0, right: 300, top: 0, bottom: 700 }
  const start = { x: 150, y: 680 }
  // Just picked up low in the column: no scrolling yet.
  expect(mayScroll(start, { x: 150, y: 690 }, column)).toBe(false)
  expect(mayScroll(start, { x: 150, y: 640 }, column)).toBe(false)
  expect(mayScroll(start, { x: 150, y: 699 }, column)).toBe(false)
  // Carried on down the column: it scrolls.
  expect(mayScroll({ x: 150, y: 600 }, { x: 150, y: 690 }, column)).toBe(true)
  // Carried sideways to the next column at the same height: this column stays put.
  expect(mayScroll(start, { x: 400, y: 690 }, column)).toBe(false)
})

