import { expect, test } from 'vitest'
import { place, step } from './combobox'

test('arrow keys wrap around the options', () => {
  expect(step(-1, 1, 3)).toBe(0)
  expect(step(-1, -1, 3)).toBe(2)
  expect(step(2, 1, 3)).toBe(0)
  expect(step(0, -1, 3)).toBe(2)
  expect(step(1, 1, 3)).toBe(2)
})

test('nothing is highlighted without options', () => {
  expect(step(2, 1, 0)).toBe(-1)
})

test('the dropdown is full width under the input on a wide screen', () => {
  expect(place({ left: 22, bottom: 80, width: 224 }, { width: 1440, height: 900 })).toEqual({ left: 22, top: 84, width: 420, maxHeight: 540 })
})

test('the dropdown shrinks to fit a narrow screen', () => {
  const p = place({ left: 10, bottom: 80, width: 340 }, { width: 360, height: 700 })
  expect(p.left).toBe(10)
  expect(p.left + p.width).toBe(348)
})

test('the dropdown never runs past the bottom of the screen', () => {
  expect(place({ left: 22, bottom: 500, width: 224 }, { width: 1440, height: 700 }).maxHeight).toBe(184)
})

test('the dropdown is as wide as a full-width input', () => {
  expect(place({ left: 10, bottom: 80, width: 700 }, { width: 720, height: 900 })).toMatchObject({ left: 10, width: 698 })
})

test('an input near the bottom gets no height rather than spilling off screen', () => {
  expect(place({ left: 22, bottom: 690, width: 224 }, { width: 1440, height: 700 }).maxHeight).toBe(0)
})
