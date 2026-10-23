import { expect, test } from 'vitest'
import { settle } from './agents'

const now = Date.parse('2026-10-23T12:00:00Z')
const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600 * 1000).toISOString()

test('a session that stopped reporting long ago is idle, not working or waiting', () => {
  expect(settle({ state: 'working', updated: at(13) }, now).state).toBe('idle')
  expect(settle({ state: 'needs-input', updated: at(13) }, now).state).toBe('idle')
})

test('recent states and ended sessions stay as reported', () => {
  expect(settle({ state: 'working', updated: at(1) }, now).state).toBe('working')
  expect(settle({ state: 'ended', updated: at(13) }, now).state).toBe('ended')
})
