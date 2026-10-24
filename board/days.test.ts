import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-days-'))
vi.stubEnv('SECOND_BRAIN_VAULT', scratch)
const { deleteCairn, recentDays, saveCairn, updateDay } = await import('./days')
const { readDoc } = await import('../lib/vault.mjs')

const day = (date: string) => path.join(scratch, 'days', `${date}.md`)
beforeEach(() => { fs.rmSync(path.join(scratch, 'days'), { recursive: true, force: true }); fs.rmSync(path.join(scratch, 'cairns'), { recursive: true, force: true }) })
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))

test('a new day file holds the cairns and ways in its frontmatter', () => {
  updateDay('2026-10-23', { cairns: { breathe: 'done' }, ways: { '14:00': { kind: 'deep', task: 'T-0113' } } })
  expect(readDoc(day('2026-10-23'))).toEqual({ data: { cairns: { breathe: 'done' }, ways: { '14:00': { kind: 'deep', task: 'T-0113' } } }, body: '' })
})

test('updates merge, counts add up, null clears, and what was written by hand stays', () => {
  fs.mkdirSync(path.join(scratch, 'days'), { recursive: true })
  fs.writeFileSync(day('2026-10-23'), '---\nmood: calm\ncairns:\n  water: 2\n  breathe: done\n---\nA good day.\n')
  updateDay('2026-10-23', { add: { water: 1, stretch: 1 } })
  updateDay('2026-10-23', { add: { water: 1 }, cairns: { breathe: null } })
  expect(readDoc(day('2026-10-23'))).toEqual({ data: { mood: 'calm', cairns: { water: 4, stretch: 1 } }, body: 'A good day.\n' })
  updateDay('2026-10-23', { cairns: { water: null, stretch: null } })
  expect(readDoc(day('2026-10-23')).data).toEqual({ mood: 'calm' })
})

test('a day file with broken frontmatter is never written over', () => {
  fs.mkdirSync(path.join(scratch, 'days'), { recursive: true })
  fs.writeFileSync(day('2026-10-23'), '---\ncairns: [oops\n---\n')
  expect(() => updateDay('2026-10-23', { cairns: { water: 1 } })).toThrow(/invalid frontmatter/)
  expect(fs.readFileSync(day('2026-10-23'), 'utf8')).toBe('---\ncairns: [oops\n---\n')
})

test('dates and slugs must look like dates and slugs', () => {
  expect(() => updateDay('../tasks/T-0001', {})).toThrow(/invalid date/)
  expect(() => saveCairn('../x', {}, true)).toThrow(/invalid cairn/)
})

test('recent days lists the last week of day files that exist', () => {
  updateDay('2026-10-23', { cairns: { breathe: 'done' } })
  updateDay('2026-10-20', { cairns: { breathe: 'done' } })
  updateDay('2026-10-10', { cairns: { breathe: 'done' } })
  expect(recentDays(7, new Date('2026-10-23T12:00')).map((d) => d.name)).toEqual(['2026-10-23', '2026-10-20'])
})

test('cairns are saved, edited with their notes kept, and deleted', () => {
  saveCairn('breathe', { name: 'Breathe', kind: 'timer', minutes: 3 }, true)
  expect(() => saveCairn('breathe', { name: 'Breathe' }, true)).toThrow(/already exists/)
  fs.writeFileSync(path.join(scratch, 'cairns', 'breathe.md'), '---\nname: Breathe\nkind: timer\nminutes: 3\nat: "08:30"\nplace: window\n---\nSit by the window.\n')
  saveCairn('breathe', { name: 'Breathe', kind: 'timer', minutes: 5 }, false)
  expect(readDoc(path.join(scratch, 'cairns', 'breathe.md'))).toEqual({ data: { name: 'Breathe', kind: 'timer', minutes: 5, place: 'window' }, body: 'Sit by the window.\n' })
  deleteCairn('breathe')
  expect(fs.existsSync(path.join(scratch, 'cairns', 'breathe.md'))).toBe(false)
})
