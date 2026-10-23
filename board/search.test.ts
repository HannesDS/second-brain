import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const rag = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('../lib/rag.mjs', () => rag)

process.env.SECOND_BRAIN_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'))
const { writeDoc } = await import('../lib/vault.mjs')
const { search } = await import('./search')

const vault = process.env.SECOND_BRAIN_VAULT
writeDoc(path.join(vault, 'tasks/T-0001.md'), { title: 'Gantt colours' }, 'The gantt uses tokens.\n')
writeDoc(path.join(vault, 'notes/Ideas.md'), { title: 'Ideas' }, 'A gantt for meetings, a gantt for notes, a gantt for gantts.\n')

const hit = (p: string, score: number) => ({ path: p, score, text: `Title of ${p} (${p}; status: todo)\nchunk text` })

beforeEach(() => { rag.search.mockReset() })
afterAll(() => { fs.rmSync(vault, { recursive: true, force: true }) })

test('semantic hits come first, then text matches they missed', async () => {
  rag.search.mockResolvedValue([hit('meetings/Standup.md', 0.8), hit('tasks/T-0001.md', 0.6)])
  const out = await search('gantt')
  expect(out.map((r: any) => r.path)).toEqual(['meetings/Standup.md', 'tasks/T-0001.md', 'notes/Ideas.md'])
  expect(out[0]).toMatchObject({ dir: 'meetings', name: 'Standup', title: 'Title of meetings/Standup.md', snippet: 'chunk text' })
})

test('weak semantic hits are dropped', async () => {
  rag.search.mockResolvedValue([hit('meetings/Standup.md', 0.3)])
  expect((await search('gantt')).map((r: any) => r.path)).toEqual(['notes/Ideas.md', 'tasks/T-0001.md'])
})

test('falls back to text search when the embeddings are down', async () => {
  rag.search.mockRejectedValue(new Error('Ollama down'))
  const out = await search('gantt')
  expect(out.map((r: any) => [r.path, r.score])).toEqual([['notes/Ideas.md', 4], ['tasks/T-0001.md', 2]])
})
