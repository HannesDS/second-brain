import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-notes-'))
vi.stubEnv('SECOND_BRAIN_VAULT', scratch)
const { applyFiling, createNote } = await import('./notes')
const { readDoc } = await import('../lib/vault.mjs')

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))

test('two thoughts saved in the same minute both stay', () => {
  const a = createNote('', 'first')
  const b = createNote('', 'second')
  expect(b).not.toBe(a)
  expect(readDoc(path.join(scratch, a)).body).toBe('first')
  expect(readDoc(path.join(scratch, b)).body).toBe('second')
})

test('a meeting note can link another meeting', () => {
  fs.mkdirSync(path.join(scratch, 'meetings'), { recursive: true })
  fs.writeFileSync(path.join(scratch, 'meetings', 'm.md'), '---\ndate: 2026-10-23\n---\nNotes\n')
  expect(applyFiling('meetings/m.md', [{ kind: 'link-meeting', meeting: 'other' }])).toEqual(['linked to other'])
  expect(readDoc(path.join(scratch, 'meetings', 'm.md')).data.meetings).toEqual(['[[other]]'])
})
