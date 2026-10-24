import { expect, test } from 'vitest'
import { blockersOf, chainOf, edgesOf, groupsOf, laneOf, layers, layout, linked, openChains, parentOf } from './chains'

const task = (name: string, blocked_by = '', body = '', status = 'todo') => ({ name, data: { status, blocked_by }, body })
const names = (ts: { name: string }[]) => ts.map((t) => t.name)

// T-0001 -> T-0002 -> T-0004, T-0003 -> T-0004; T-0005 -> T-0006 is a separate chain; T-0007 stands alone.
const tasks = [
  task('T-0001'),
  task('T-0002', '[[T-0001]]'),
  task('T-0003'),
  task('T-0004', '[[T-0002]], [[T-0003]]'),
  task('T-0005'),
  task('T-0006', 'T-0005'),
  task('T-0007'),
]

test('reads blockers and the parent line', () => {
  expect(blockersOf(task('T-0002', '[[T-0001]], [[T-0003|x]]'))).toEqual(['T-0001', 'T-0003'])
  expect(blockersOf({ name: 'T-0001', data: {} })).toEqual([])
  expect(parentOf(task('T-0002', '', 'Parent: [[T-0009]]\n\nBody'))).toBe('T-0009')
  expect(parentOf(task('T-0002', '', 'No parent here'))).toBeUndefined()
})

test('edges go blocker to dependent and skip tasks that are not shown', () => {
  expect(edgesOf([task('T-0001'), task('T-0002', '[[T-0001]], [[T-0099]]')])).toEqual([{ from: 'T-0001', to: 'T-0002' }])
})

test('only tasks with a blocker or a dependent are linked', () => {
  expect([...linked(tasks)].sort()).toEqual(['T-0001', 'T-0002', 'T-0003', 'T-0004', 'T-0005', 'T-0006'])
})

test("a ticket's chain is what it waits on and what waits on it, transitively", () => {
  expect(names(chainOf(tasks, 'T-0002'))).toEqual(['T-0001', 'T-0002', 'T-0004'])
  expect(names(chainOf(tasks, 'T-0004'))).toEqual(['T-0001', 'T-0002', 'T-0003', 'T-0004'])
  expect(names(chainOf(tasks, 'T-0007'))).toEqual(['T-0007'])
})

test('each task lands one column after its furthest blocker', () => {
  expect(Object.fromEntries(layers(tasks))).toMatchObject({ 'T-0001': 0, 'T-0002': 1, 'T-0003': 0, 'T-0004': 2, 'T-0005': 0, 'T-0006': 1 })
})

test('a cycle does not loop forever', () => {
  const l = layers([task('T-0001', 'T-0002'), task('T-0002', 'T-0001')])
  expect([...l.keys()].sort()).toEqual(['T-0001', 'T-0002'])
})

test('tickets that connect through blockers form one group per chain', () => {
  const g = groupsOf(tasks)
  expect(new Set(['T-0001', 'T-0002', 'T-0003', 'T-0004'].map((n) => g.get(n)))).toEqual(new Set(['T-0001']))
  expect(g.get('T-0006')).toBe('T-0005')
  expect(g.get('T-0007')).toBe('T-0007')
})

test('a chain with every ticket done is left out of the open chains', () => {
  const done = [task('T-0001', '', '', 'done'), task('T-0002', 'T-0001', '', 'done'), task('T-0003', '', '', 'done'), task('T-0004', 'T-0003')]
  expect(names(openChains(done))).toEqual(['T-0003', 'T-0004'])
})

test('a parent groups its children and itself into one lane, newest lane first', () => {
  const feature = [task('T-0010'), task('T-0011', '', 'Parent: [[T-0010]]'), task('T-0012', 'T-0011', 'Parent: [[T-0010]]'), task('T-0001'), task('T-0013', 'T-0001')]
  expect(feature.map((t) => laneOf(t, feature))).toEqual(['T-0010', 'T-0010', 'T-0010', '', ''])
  const { pos, lanes } = layout(feature)
  expect(lanes.map((l) => [l.lane, l.head])).toEqual([['chain:T-0001', 'T-0013'], ['T-0010', 'T-0010']])
  expect(pos.get('T-0012')!.x).toBeGreaterThan(pos.get('T-0011')!.x)
  // T-0010 and T-0011 share column 0 in the lane, so they stack.
  expect(pos.get('T-0010')!.x).toBe(pos.get('T-0011')!.x)
  expect(pos.get('T-0011')!.y).toBeGreaterThan(pos.get('T-0010')!.y)
  // The feature lane sits below the newer chain.
  expect(pos.get('T-0010')!.y).toBeGreaterThanOrEqual(lanes[0].y + lanes[0].height)
})

test('loose chains get a lane each, named by their last ticket, so they never interleave', () => {
  const { pos, lanes, height } = layout(tasks.filter((t) => t.name !== 'T-0007'))
  expect(lanes.map((l) => l.head)).toEqual(['T-0006', 'T-0004'])
  const [b, a] = lanes
  for (const n of ['T-0005', 'T-0006']) expect(pos.get(n)!.y).toBeLessThan(b.y + b.height)
  for (const n of ['T-0001', 'T-0002', 'T-0003', 'T-0004']) expect(pos.get(n)!.y).toBeGreaterThanOrEqual(a.y)
  expect(height).toBe(a.y + a.height)
})
