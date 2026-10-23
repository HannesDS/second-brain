import { expect, test } from 'vitest'
import { daysOf, heading, step } from './calendarView'

const iso = (d: Date) => d.toLocaleDateString('sv')
const fri = new Date(2026, 9, 23) // Friday 23 October 2026

test('a month is six weeks from the Monday on/before the 1st', () => {
  const days = daysOf('month', fri)
  expect(days).toHaveLength(42)
  expect(iso(days[0])).toBe('2026-09-28')
  expect(iso(days[41])).toBe('2026-11-08')
})

test('a week runs Monday to Sunday, also from a Sunday', () => {
  expect(daysOf('week', fri).map(iso)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  expect(iso(daysOf('week', new Date(2026, 9, 25))[0])).toBe('2026-10-19')
})

test('a day is just that day, at midnight', () => {
  expect(daysOf('day', new Date(2026, 9, 23, 15, 30))).toEqual([new Date(2026, 9, 23)])
})

test('steps by a month, a week or a day', () => {
  expect(iso(step('month', new Date(2026, 0, 31), 1))).toBe('2026-02-01')
  expect(iso(step('month', fri, -10))).toBe('2025-12-01')
  expect(iso(step('week', fri, 1))).toBe('2026-10-30')
  expect(iso(step('day', new Date(2026, 11, 31), 1))).toBe('2027-01-01')
})

test('names what each view shows', () => {
  expect(heading('month', fri)).toBe('October 2026')
  expect(heading('week', new Date(2026, 9, 29))).toBe('26 Oct – 1 Nov 2026')
  expect(heading('day', fri)).toBe('Friday, 23 October 2026')
})
