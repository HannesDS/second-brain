import { expect, test, vi } from 'vitest'
import { startReady } from './queue'

const task = (name: string, data: Record<string, any>) => ({ name, data: { status: 'ready', priority: 'p2', ...data } })

function started(tasks: ReturnType<typeof task>[], running = new Set<string>(), max = 3) {
  const start = vi.fn()
  startReady(tasks, running, max, start)
  return start.mock.calls.map(([t]) => t)
}

test('starts only ready tasks, most urgent first, then by order', () => {
  expect(started([
    task('T-0001', { priority: 'p2' }),
    task('T-0002', { priority: 'p1', order: 2 }),
    task('T-0003', { priority: 'p1', order: 1 }),
    task('T-0004', { status: 'todo', priority: 'p0' }),
  ])).toEqual(['T-0003', 'T-0002', 'T-0001'])
})

test('waits until every blocker is done', () => {
  expect(started([
    task('T-0001', { status: 'done' }),
    task('T-0002', { status: 'wip' }),
    task('T-0003', { blocked_by: '[[T-0001]]' }),
    task('T-0004', { blocked_by: '[[T-0001]], [[T-0002]]' }),
    task('T-0005', { blocked_by: 'T-0009' }),
  ])).toEqual(['T-0003'])
})

test('keeps to the cap, counting runs already going', () => {
  const tasks = ['T-0001', 'T-0002', 'T-0003', 'T-0004'].map((n) => task(n, {}))
  expect(started(tasks, new Set(['T-0001']), 3)).toEqual(['T-0002', 'T-0003'])
  expect(started(tasks, new Set(['T-0001', 'T-0002', 'T-0003']), 3)).toEqual([])
})

test('a task that fails to start does not take a slot', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const start = vi.fn((t: string) => { if (t === 'T-0001') throw new Error('no repo') })
  startReady(['T-0001', 'T-0002'].map((n) => task(n, {})), new Set(), 1, start)
  expect(start.mock.calls.map(([t]) => t)).toEqual(['T-0001', 'T-0002'])
})
