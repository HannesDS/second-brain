import { describe, expect, it } from 'vitest'
import { modeOf, resolveMode } from './theme'

describe('resolveMode', () => {
  it('keeps an explicit light or dark choice, whatever the OS says', () => {
    expect(resolveMode('light', true)).toBe('light')
    expect(resolveMode('dark', false)).toBe('dark')
  })
  it('follows the OS for system', () => {
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('system', false)).toBe('light')
  })
})

describe('modeOf', () => {
  it('reads a stored mode', () => {
    expect(modeOf('dark')).toBe('dark')
    expect(modeOf('system')).toBe('system')
  })
  it('falls back to light for anything else', () => {
    expect(modeOf(null)).toBe('light')
    expect(modeOf('moss')).toBe('light')
    expect(modeOf(1)).toBe('light')
  })
})
