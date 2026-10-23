import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { ownWrites } from './own-writes'

test('tells a tab\'s own write from a later change elsewhere', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-')), 'T-0001.md')
  fs.writeFileSync(file, 'board')
  const writes = ownWrites()
  writes.mark(file, 'tab-1')
  expect(writes.writer(file)).toBe('tab-1')
  // A watcher can fire more than once for one write.
  expect(writes.writer(file)).toBe('tab-1')
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000))
  expect(writes.writer(file)).toBeUndefined()
  expect(ownWrites().writer(file)).toBeUndefined()
})

test('a deleted file is never a tab\'s own write', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-')), 'gone.md')
  expect(ownWrites().writer(file)).toBeUndefined()
})

test('a file is forgotten a minute after it was written, once the board writes again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-'))
  const [a, b] = ['a.md', 'b.md'].map((f) => path.join(dir, f))
  for (const f of [a, b]) fs.writeFileSync(f, 'board')
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    const writes = ownWrites()
    writes.mark(a, 'tab-1')
    vi.advanceTimersByTime(61_000)
    writes.mark(b, 'tab-1')
    expect(writes.writer(a)).toBeUndefined()
    expect(writes.writer(b)).toBe('tab-1')
  } finally { vi.useRealTimers() }
})

