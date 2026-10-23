import { expect, test } from 'vitest'
import { dragOver, dropMoves, type Layout } from './drag'

const layout: Layout = { todo: ['A', 'B', 'C'], wip: ['D', 'E'], done: ['F'] }
const data: Record<string, { status: string; order: number }> = {
  A: { status: 'todo', order: 0 }, B: { status: 'todo', order: 1 }, C: { status: 'todo', order: 2 },
  D: { status: 'wip', order: 0 }, E: { status: 'wip', order: 1 }, F: { status: 'done', order: 0 },
}
const current = (id: string) => data[id]

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

test('a reorder writes only the cards whose order changed', () => {
  expect(dropMoves(layout, 'C', 'B', current)).toEqual([
    { id: 'C', status: 'todo', order: 1 },
    { id: 'B', status: 'todo', order: 2 },
  ])
})

test('a drop onto its own place writes nothing', () => {
  expect(dropMoves(layout, 'B', 'B', current)).toEqual([])
})

test('a move to another column writes the card and the cards it pushed down', () => {
  // After the preview the card sits under the pointer, so it's over itself.
  expect(dropMoves(dragOver(layout, 'A', 'E'), 'A', 'A', current)).toEqual([
    { id: 'A', status: 'wip', order: 1 },
    { id: 'E', status: 'wip', order: 2 },
  ])
})

test('a drop onto the column moves the card last of the cards shown', () => {
  expect(dropMoves(layout, 'A', 'col:todo', current)).toEqual([
    { id: 'B', status: 'todo', order: 0 },
    { id: 'C', status: 'todo', order: 1 },
    { id: 'A', status: 'todo', order: 2 },
  ])
  expect(dropMoves(layout, 'A', 'col:todo', current, 2).map((m) => m.id)).toEqual(['B', 'A'])
})

test('Done takes only the card itself, and has no order to change', () => {
  expect(dropMoves(dragOver(layout, 'D', 'F'), 'D', 'F', current)).toEqual([{ id: 'D', status: 'done', order: 0 }])
  expect(dropMoves({ ...layout, done: ['F', 'G'] }, 'F', 'G', (id) => ({ status: 'done', order: id === 'F' ? 0 : 1 }))).toEqual([])
})
