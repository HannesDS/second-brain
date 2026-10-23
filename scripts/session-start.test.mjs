import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, test } from 'vitest'

const vault = process.env.SECOND_BRAIN_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'))
const { readDoc, writeDoc } = await import('../lib/vault.mjs')
const taskFile = path.join(vault, 'tasks/T-0007.md')

// Runs the hook the way Claude Code does: hook input on stdin, the task in $TASK_ID.
function hook(env, input = { session_id: 'abc-123', cwd: '/repo' }) {
  return spawnSync(process.execPath, [path.join(import.meta.dirname, 'session-start.mjs')], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SECOND_BRAIN_VAULT: vault, CLAUDE_CONFIG_DIR: '/home/me/.claude-personal', ...env },
  })
}

beforeEach(() => {
  fs.rmSync(vault, { recursive: true, force: true })
  writeDoc(taskFile, { title: 'Fix the board', project: '[[workbench]]', status: 'ready', priority: 'p1', sessions: [], blocked_by: '' }, '## What to build\n\nA fix.\n')
})

afterAll(() => { fs.rmSync(vault, { recursive: true, force: true }) })

test('stays silent without TASK_ID', () => {
  const out = hook({})
  expect(out.stdout).toBe('')
  expect(out.stderr).toBe('')
})

test('puts the task in context, links the session and starts the task', () => {
  const out = hook({ TASK_ID: 'T-0007' })
  expect(out.stdout).toContain(`This session works on task T-0007: "Fix the board" (file: ${taskFile}).`)
  expect(out.stdout).toContain('<task id="T-0007">\nproject: [[workbench]]\nstatus: ready\npriority: p1\n\n## What to build\n\nA fix.\n</task>')

  const task = readDoc(taskFile)
  expect(task.data).toMatchObject({ status: 'wip', sessions: ['abc-123'] })
  expect(task.body).toBe('## What to build\n\nA fix.\n')
  const session = readDoc(path.join(vault, 'sessions/abc-123.md'))
  expect(session.data).toMatchObject({ task: '[[T-0007]]', cwd: '/repo', account: 'personal' })
  expect(session.body).toContain('claude --resume abc-123')
})

test('a second start of the same session changes nothing', () => {
  hook({ TASK_ID: 'T-0007' })
  const before = fs.readFileSync(taskFile, 'utf8')
  hook({ TASK_ID: 'T-0007' })
  expect(fs.readFileSync(taskFile, 'utf8')).toBe(before)
})

test('an unknown task is reported on stderr and not put in context', () => {
  const out = hook({ TASK_ID: 'T-9999' })
  expect(out.stdout).toBe('')
  expect(out.stderr).toContain('task T-9999 not found')
})
