import { expect, test } from 'vitest'
import { CLEARING, H, W, clearingOf, hillOf, matchesNote, shortWhen, type Note } from './clearing'
import type { Doc } from './lib'

const note = (path: string, data: Record<string, any> = {}, excerpt = ''): Note =>
  ({ path, name: path.replace(/^\w+\//, '').replace(/\.md$/, ''), data, excerpt, mtime: '2026-10-23T12:00:00.000Z' })
const task = (name: string, project: string): Doc => ({ name, data: { project: `[[${project}]]` }, body: '' })

const sapling = note('inbox/2026-10-23 1622 Front-end sweep.md', { status: 'inbox' }, 'Lots of overlays when you press things')
const older = note('inbox/2026-10-23 0848 Feedback.md', { status: 'inbox' }, 'Rename the project')
const viaTask = note('inbox/2026-10-23 1509 Agent listing.md', { status: 'filed', tasks: ['[[T-0101]]'] })
const ownProject = note('inbox/2026-10-23 1449 Data Minds Saturday.md', { status: 'filed', project: '[[public-speaking]]', tasks: ['[[T-0099]]'] })
const meeting = note('meetings/2026-10-22 Standup.md', {})
const tasks = [task('T-0101', 'workbench'), task('T-0099', 'workbench')]

test('search matches every word in the title, the first line or a task id', () => {
  expect(matchesNote(sapling, 'front SWEEP')).toBe(true)
  expect(matchesNote(sapling, 'overlays')).toBe(true)
  expect(matchesNote(viaTask, 't-0101')).toBe(true)
  expect(matchesNote(sapling, 'sweep calendar')).toBe(false)
  expect(matchesNote(older, '')).toBe(true)
})

test('a filed thought grows on its own project, else on its first task\'s', () => {
  expect(hillOf(ownProject, tasks)).toBe('public-speaking')
  expect(hillOf(viaTask, tasks)).toBe('workbench')
  expect(hillOf(note('inbox/x.md', { status: 'filed' }), tasks)).toBe('')
})

test('one sapling per unfiled thought in the clearing, the newest marked', () => {
  const c = clearingOf([older, viaTask, sapling, ownProject, meeting], tasks)
  expect(c.saplings.map((s) => s.path)).toEqual([sapling.path, older.path])
  expect(c.newest).toBe(sapling.path)
  for (const s of c.saplings) expect(((s.x - CLEARING.x) / c.rx) ** 2 + ((s.y - CLEARING.y) / c.ry) ** 2).toBeLessThanOrEqual(1)
})

test('one tree per filed thought, on its project\'s hill; meetings are not on the sheet', () => {
  const c = clearingOf([older, viaTask, sapling, ownProject, meeting], tasks)
  expect(c.woods.map((w) => [w.project, w.trees.map((t) => t.path)])).toEqual([
    ['public-speaking', [ownProject.path]], ['workbench', [viaTask.path]],
  ])
  const all = [...c.woods.flatMap((w) => [w, ...w.trees]), ...c.saplings]
  for (const p of all) {
    expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(W)
    expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(H)
  }
  // Hills stay beside the clearing, never on it.
  for (const w of c.woods) expect(Math.abs(w.x - CLEARING.x) - w.r).toBeGreaterThan(c.rx)
})

test('many projects share the room, the biggest first', () => {
  const many = Array.from({ length: 9 }, (_, i) => Array.from({ length: i + 1 }, (_, j) =>
    note(`inbox/2026-10-0${j + 1} 1000 p${i}-${j}.md`, { status: 'filed', project: `[[p${i}]]` }))).flat()
  const c = clearingOf(many, [])
  expect(c.woods[0].project).toBe('p8')
  expect(c.woods.reduce((s, w) => s + w.trees.length, 0)).toBe(many.length)
  for (const w of c.woods) { expect(w.x - w.r).toBeGreaterThanOrEqual(0); expect(w.x + w.r).toBeLessThanOrEqual(W) }
  expect(clearingOf(many, [])).toEqual(c)
})

test('times read short: today, this week, earlier', () => {
  const now = new Date(2026, 9, 23, 18, 0)
  expect(shortWhen(sapling, now)).toBe('16:22')
  expect(shortWhen(note('inbox/2026-10-22 1126 Agent per project.md'), now)).toBe('Thu 11:26')
  expect(shortWhen(note('meetings/2026-10-21 Standup.md'), now)).toBe('Wed')
  expect(shortWhen(note('inbox/2026-10-02 0900 Old.md'), now)).toBe('2 Oct')
})
