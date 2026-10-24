import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, test } from 'vitest'

process.env.SECOND_BRAIN_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'))
const { VAULT, nextTaskId, readDoc, today, updateDoc, writeDoc } = await import('./vault.mjs')

const tasks = path.join(VAULT, 'tasks')
const write = (name, text) => { fs.mkdirSync(tasks, { recursive: true }); fs.writeFileSync(path.join(tasks, name), text) }

beforeEach(() => fs.rmSync(tasks, { recursive: true, force: true }))
afterAll(() => { fs.rmSync(VAULT, { recursive: true, force: true }) })

test('readDoc splits frontmatter from body', () => {
  write('a.md', '---\ntitle: A\nstatus: todo\n---\nBody\n')
  expect(readDoc(path.join(tasks, 'a.md'))).toEqual({ data: { title: 'A', status: 'todo' }, body: 'Body\n' })
})

test('readDoc without frontmatter returns the whole text as body', () => {
  write('a.md', 'Just text\n')
  expect(readDoc(path.join(tasks, 'a.md'))).toEqual({ data: {}, body: 'Just text\n' })
})

test('readDoc only ends the frontmatter at a line of its own', () => {
  write('a.md', '---\ntitle: before---after\nstatus: todo\n---\nBody\n')
  expect(readDoc(path.join(tasks, 'a.md'))).toEqual({ data: { title: 'before---after', status: 'todo' }, body: 'Body\n' })
})

test('readDoc allows spaces after the closing ---', () => {
  write('a.md', '---\ntitle: A\n---  \nBody\n')
  expect(readDoc(path.join(tasks, 'a.md'))).toEqual({ data: { title: 'A' }, body: 'Body\n' })
})

test('readDoc reads empty frontmatter', () => {
  write('a.md', '---\n---\nBody\n')
  expect(readDoc(path.join(tasks, 'a.md'))).toEqual({ data: {}, body: 'Body\n' })
})

test('readDoc reports broken YAML instead of throwing', () => {
  write('a.md', '---\ntitle: [unclosed\n---\nBody\n')
  const doc = readDoc(path.join(tasks, 'a.md'))
  expect(doc.data).toEqual({})
  expect(doc.body).toBe('Body\n')
  expect(doc.error).toBeTruthy()
})

test('updateDoc merges the patch, keeps hand-added fields and the body, and stamps updated', () => {
  const file = path.join(tasks, 'a.md')
  writeDoc(file, { title: 'A', status: 'todo', custom: 'mine' }, 'Body\n')
  // It hands back the frontmatter as it was, so a caller can see what changed.
  expect(updateDoc(file, { status: 'wip' })).toEqual({ title: 'A', status: 'todo', custom: 'mine' })
  expect(readDoc(file)).toEqual({ data: { title: 'A', status: 'wip', custom: 'mine', updated: today() }, body: 'Body\n' })
})

test('updateDoc refuses to overwrite broken frontmatter', () => {
  write('a.md', '---\ntitle: [unclosed\n---\nBody\n')
  const file = path.join(tasks, 'a.md')
  expect(() => updateDoc(file, { status: 'wip' })).toThrow(/invalid frontmatter/)
  expect(fs.readFileSync(file, 'utf8')).toBe('---\ntitle: [unclosed\n---\nBody\n')
})

test('nextTaskId starts at T-0001', () => {
  expect(nextTaskId()).toBe('T-0001')
})

test('nextTaskId follows the highest id and ignores other files', () => {
  write('T-0002.md', '---\ntitle: two\n---\n')
  write('T-0041.md', '---\ntitle: forty-one\n---\n')
  write('notes.md', 'not a task\n')
  expect(nextTaskId()).toBe('T-0042')
})
