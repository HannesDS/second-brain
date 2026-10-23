import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const rag = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('../lib/rag.mjs', () => rag)
// The claude CLI: answers with whatever `reply` holds and keeps the prompt it got.
const cli = vi.hoisted(() => ({ prompt: '', reply: '' }))
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, done: (e: Error | null, out: { stdout: string }) => void) => {
    cli.prompt = args.at(-1)!
    done(null, { stdout: JSON.stringify({ result: cli.reply }) })
  },
}))

process.env.SECOND_BRAIN_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'))
const { writeDoc } = await import('../lib/vault.mjs')
const { ask } = await import('./ask')

const vault = process.env.SECOND_BRAIN_VAULT
writeDoc(path.join(vault, 'tasks/T-0001.md'), { title: 'Gantt colours' }, 'The gantt uses tokens.\n')
writeDoc(path.join(vault, 'notes/Ideas.md'), { title: 'Ideas' }, 'A gantt for meetings.\n')

beforeEach(() => { rag.search.mockRejectedValue(new Error('Ollama down')); cli.prompt = ''; cli.reply = 'Tokens [1].' })
afterAll(() => { fs.rmSync(vault, { recursive: true, force: true }) })

test('answers from the numbered docs inside the filters only', async () => {
  const out = await ask('gantt', ['tasks/T-0001.md'])
  expect(out).toEqual({ answer: 'Tokens [1].', sources: [{ path: 'tasks/T-0001.md', title: 'Gantt colours' }] })
  expect(cli.prompt).toContain('[1] Gantt colours (tasks/T-0001.md)\nThe gantt uses tokens.')
  expect(cli.prompt).not.toContain('Ideas')
})

test('nothing found means no Claude call', async () => {
  expect(await ask('gantt', ['projects/none.md'])).toEqual({ answer: '', sources: [] })
  expect(cli.prompt).toBe('')
})
