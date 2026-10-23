import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { settle } from './settle.mjs'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('runs once, after the last call', () => {
  const fn = vi.fn()
  const soon = settle(fn)
  soon(2000)
  vi.advanceTimersByTime(1500)
  soon(2000)
  vi.advanceTimersByTime(1999)
  expect(fn).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(fn).toHaveBeenCalledOnce()
})

test('a short wait does not cut a longer one short', () => {
  const fn = vi.fn()
  const soon = settle(fn)
  soon(10_000)
  soon(2000)
  vi.advanceTimersByTime(9999)
  expect(fn).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(fn).toHaveBeenCalledOnce()
  // Once it ran, a short wait is short again.
  soon(2000)
  vi.advanceTimersByTime(2000)
  expect(fn).toHaveBeenCalledTimes(2)
})

test('a missing wait counts as none and still leaves a longer one standing', () => {
  const fn = vi.fn()
  const soon = settle(fn)
  soon(10_000)
  soon()
  vi.advanceTimersByTime(9999)
  expect(fn).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(fn).toHaveBeenCalledOnce()
})

