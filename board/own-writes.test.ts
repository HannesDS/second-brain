import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { ownWrites } from './own-writes'

test('tells the board\'s own write from a later change elsewhere', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-')), 'T-0001.md')
  fs.writeFileSync(file, 'board')
  const writes = ownWrites()
  writes.mark(file)
  expect(writes.isOwn(file)).toBe(true)
  // A watcher can fire more than once for one write.
  expect(writes.isOwn(file)).toBe(true)
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000))
  expect(writes.isOwn(file)).toBe(false)
  expect(ownWrites().isOwn(file)).toBe(false)
})

test('a deleted file is never our own write', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-')), 'gone.md')
  expect(ownWrites().isOwn(file)).toBe(false)
})
