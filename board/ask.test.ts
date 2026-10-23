import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const rag = vi.hoisted(() => ({ search: vi.fn(), OLLAMA: 'http://ollama' }))
vi.mock('../lib/rag.mjs', () => rag)
// Ollama's chat endpoint: answers with whatever `reply` holds and keeps the request it got.
const llm = vi.hoisted(() => ({ url: '', body: undefined as any, reply: '' }))
vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
  llm.url = url
  llm.body = JSON.parse(init.body)
  return new Response(JSON.stringify({ message: { role: 'assistant', content: llm.reply } }))
})

process.env.SECOND_BRAIN_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'))
const { writeDoc } = await import('../lib/vault.mjs')
const { ask } = await import('./ask')

const vault = process.env.SECOND_BRAIN_VAULT
writeDoc(path.join(vault, 'tasks/T-0001.md'), { title: 'Gantt colours' }, 'The gantt uses tokens.\n')
writeDoc(path.join(vault, 'notes/Ideas.md'), { title: 'Ideas' }, 'A gantt for meetings.\n')

beforeEach(() => { rag.search.mockRejectedValue(new Error('Ollama down')); llm.body = undefined; llm.reply = 'Tokens [1].' })
afterAll(() => { fs.rmSync(vault, { recursive: true, force: true }) })

test('the local model answers from the numbered docs inside the filters only', async () => {
  const out = await ask('gantt', ['tasks/T-0001.md'])
  expect(out).toEqual({ answer: 'Tokens [1].', sources: [{ path: 'tasks/T-0001.md', title: 'Gantt colours' }] })
  expect(llm.url).toBe('http://ollama/api/chat')
  const prompt = llm.body.messages[0].content
  expect(prompt).toContain('[1] Gantt colours (tasks/T-0001.md)\nThe gantt uses tokens.')
  expect(prompt).not.toContain('Ideas')
})

test('nothing found means no model call', async () => {
  expect(await ask('gantt', ['projects/none.md'])).toEqual({ answer: '', sources: [] })
  expect(llm.body).toBeUndefined()
})
