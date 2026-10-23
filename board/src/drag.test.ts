import { expect, test } from 'vitest'
import { dragOver, dropMoves, type Layout } from './drag'

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

test('a card below the middle of the card it is over previews after it', () => {
  expect(dragOver(layout, 'A', 'E', undefined, true).wip).toEqual(['D', 'E', 'A'])
  expect(drop(dragOver(layout, 'A', 'E', undefined, true), 'A', 'A')).toEqual([{ id: 'A', status: 'wip', order: 30 }])
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
