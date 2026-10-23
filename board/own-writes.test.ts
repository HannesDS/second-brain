import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { ownWrites } from './own-writes'

// A task file last changed an hour ago.
function oldFile(name = 'T-0001.md') {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-')), name)
  fs.writeFileSync(file, 'before')
  const hourAgo = new Date(Date.now() - 3600_000)
  fs.utimesSync(file, hourAgo, hourAgo)
  return file
}
const board = (file: string) => () => fs.writeFileSync(file, 'board')

test('tells a tab\'s own write from a later change elsewhere', () => {
  const file = oldFile()
  const writes = ownWrites()
  writes.write(file, 'tab-1', board(file))
  expect(writes.writer(file)).toBe('tab-1')
  // A watcher can fire more than once for one write.
  expect(writes.writer(file)).toBe('tab-1')
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000))
  expect(writes.writer(file)).toBeUndefined()
  expect(ownWrites().writer(file)).toBeUndefined()
})

test('hands back what the write returns', () => {
  const file = oldFile()
  expect(ownWrites().write(file, 'tab-1', () => 'old frontmatter')).toBe('old frontmatter')
})

test('a write without a tab is a change like any other', () => {
  const file = oldFile()
  const writes = ownWrites()
  writes.write(file, undefined, board(file))
  expect(writes.writer(file)).toBeUndefined()
})

test('a write right after a change elsewhere is not claimed, so that change reaches the tab', () => {
  const file = oldFile()
  fs.writeFileSync(file, 'agent')
  const writes = ownWrites()
  writes.write(file, 'tab-1', board(file))
  expect(writes.writer(file)).toBeUndefined()
})

test('the board\'s own writes in quick succession stay claimed', () => {
  const file = oldFile()
  const writes = ownWrites()
  writes.write(file, 'tab-1', board(file))
  writes.write(file, 'tab-1', () => fs.writeFileSync(file, 'board again'))
  expect(writes.writer(file)).toBe('tab-1')
})

test('a deleted file is never a tab\'s own write', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-')), 'gone.md')
  expect(ownWrites().writer(file)).toBeUndefined()
})

test('a file is forgotten a minute after it was written, once the board writes again', () => {
  const [a, b] = [oldFile('a.md'), oldFile('b.md')]
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    const writes = ownWrites()
    writes.write(a, 'tab-1', board(a))
    vi.advanceTimersByTime(61_000)
    writes.write(b, 'tab-1', board(b))
    expect(writes.writer(a)).toBeUndefined()
    expect(writes.writer(b)).toBe('tab-1')
  } finally { vi.useRealTimers() }
})

test('another tab\'s write just before is not taken over by this tab\'s', () => {
  const file = oldFile()
  const writes = ownWrites()
  writes.write(file, 'tab-1', board(file))
  writes.write(file, 'tab-2', () => fs.writeFileSync(file, 'tab 2'))
  expect(writes.writer(file)).toBeUndefined()
})

