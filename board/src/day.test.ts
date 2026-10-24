import { expect, test } from 'vitest'
import { cairnData, cairnInContext, cairnMarks, cairnOf, isDone, isDue, meetingSpans, openStretches, scheduleOf, slugOf, trailSpan, weekDots } from './day'

const at = (h: number, m = 0) => h * 60 + m
const ev = (id: string, start: string, end: string) => ({ id, title: id, start: new Date(`2026-10-23T${start}`).toISOString(), end: new Date(`2026-10-23T${end}`).toISOString(), allDay: false })
const friday = new Date('2026-10-23T10:40')
const doc = (name: string, data: Record<string, unknown>) => ({ name, data, body: '' })

test('the trail runs 08:00 to 18:00, widened to the hour around early or late meetings', () => {
  expect(trailSpan([])).toEqual({ start: at(8), end: at(18) })
  expect(trailSpan([{ start: at(7, 30), end: at(8, 30) }, { start: at(18), end: at(19, 15) }])).toEqual({ start: at(7), end: at(20) })
})

test('open stretches are the gaps of 30 minutes or more, also before the first and after the last meeting', () => {
  const ms = meetingSpans([ev('a', '09:00', '10:00'), ev('b', '10:20', '11:00'), ev('c', '13:00', '14:00')], friday)
  const s = openStretches(ms, { start: at(8), end: at(18) })
  expect(s.map((x) => [x.start, x.end, x.after?.title, x.before?.title])).toEqual([
    [at(8), at(9), undefined, 'a'], [at(11), at(13), 'b', 'c'], [at(14), at(18), 'c', undefined],
  ])
})

test('overlapping meetings count as one block', () => {
  const ms = meetingSpans([ev('a', '09:00', '11:00'), ev('b', '09:30', '10:00')], friday)
  expect(openStretches(ms, { start: at(9), end: at(12) }).map((x) => [x.start, x.after?.title])).toEqual([[at(11), 'a']])
})

test('all-day events are not on the trail', () => {
  expect(meetingSpans([{ ...ev('x', '00:00', '23:59'), allDay: true }], friday)).toEqual([])
})

test('a cairn is due on its days, every day by default', () => {
  expect(isDue(cairnOf(doc('a', {})), friday)).toBe(true)
  expect(isDue(cairnOf(doc('a', { days: ['mon', 'tue', 'wed', 'thu', 'fri'] })), friday)).toBe(true)
  expect(isDue(cairnOf(doc('a', { days: ['sat', 'sun'] })), friday)).toBe(false)
  expect(isDue(cairnOf(doc('a', { days: ['Friday'] })), friday)).toBe(true)
})

test('a garbled cairn file falls back to defaults', () => {
  expect(cairnOf(doc('water', { kind: 'pour', at: 'noon', context: 'work', days: 'often' }))).toMatchObject({ name: 'water', kind: 'check', at: '', context: 'all', days: 'daily', nudge: false })
})

test('a cairn follows the context switch', () => {
  const dm = cairnOf(doc('a', { context: 'dm' }))
  expect([cairnInContext('', dm), cairnInContext('dataminded', dm), cairnInContext('personal', dm)]).toEqual([true, true, false])
  expect(cairnInContext('personal', cairnOf(doc('a', { context: 'all' })))).toBe(true)
})

test('a cairn sits at its time, or after its meetings', () => {
  const ms = [{ start: at(9), end: at(10) }, { start: at(13), end: at(14) }]
  expect(cairnMarks(cairnOf(doc('a', { at: '08:30' })), ms)).toEqual([at(8, 30)])
  expect(cairnMarks(cairnOf(doc('a', { after: 'meeting' })), ms)).toEqual([at(10), at(14)])
  expect(cairnMarks(cairnOf(doc('a', { after: 'first-meeting' })), ms)).toEqual([at(10)])
})

test('a count is done at its target, done is done', () => {
  const water = cairnOf(doc('water', { kind: 'count', target: 8 }))
  expect([isDone(water, 3, 8), isDone(water, 8, 8), isDone(water, 'done', 8), isDone(water, undefined, 1)]).toEqual([false, true, true, false])
})

test('only the fields a cairn uses go in its file', () => {
  expect(cairnData({ name: 'Breathe', kind: 'timer', target: 8, minutes: 3, days: ['mon'], at: '08:30', after: '', context: 'all', nudge: true }))
    .toEqual({ name: 'Breathe', kind: 'timer', minutes: 3, days: ['mon'], at: '08:30', context: 'all', nudge: true })
  expect(cairnData({ name: 'Stretch', kind: 'count', target: 3, minutes: 3, days: 'daily', at: '09:00', after: 'meeting', context: 'dm', nudge: false }))
    .toEqual({ name: 'Stretch', kind: 'count', target: 3, days: 'daily', after: 'meeting', context: 'dm', nudge: false })
  expect(slugOf('Drink wáter!')).toBe('drink-water')
})

test('the schedule reads like a person would say it', () => {
  expect(scheduleOf(cairnOf(doc('a', { at: '17:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'] })))).toBe('17:30 · weekdays')
  expect(scheduleOf(cairnOf(doc('a', { kind: 'count', target: 8 })))).toBe('8 a day · every day')
  expect(scheduleOf(cairnOf(doc('a', { after: 'meeting' })))).toBe('after each meeting · every day')
})

test('week dots come from the day files: done, missed, today, the rest ahead', () => {
  const c = cairnOf(doc('breathe', { days: ['mon', 'tue', 'wed', 'thu', 'fri'] }))
  const days = [doc('2026-10-19', { cairns: { breathe: 'done' } }), doc('2026-10-21', { cairns: { breathe: 'done' } })]
  expect(weekDots(c, friday, days, 0).map((d) => d.state)).toEqual(['done', 'missed', 'done', 'missed', 'today', 'future', 'future'])
  expect(weekDots(c, friday, [...days, doc('2026-10-23', { cairns: { breathe: 'done' } })], 0)[4].state).toBe('today-done')
})

test('after each meeting is done today once every meeting got its stretch', () => {
  const c = cairnOf(doc('stretch', { after: 'meeting' }))
  expect(weekDots(c, friday, [doc('2026-10-23', { cairns: { stretch: 2 } })], 3)[4].state).toBe('today')
  expect(weekDots(c, friday, [doc('2026-10-23', { cairns: { stretch: 3 } })], 3)[4].state).toBe('today-done')
})
