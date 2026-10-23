import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'

vi.mock('../lib/rag.mjs', () => ({ similar: () => [] }))

process.env.SECOND_BRAIN_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'))
const { writeDoc } = await import('../lib/vault.mjs')
const { knowledgeGraph } = await import('./graph')

const vault = process.env.SECOND_BRAIN_VAULT
writeDoc(path.join(vault, 'projects/umicore.md'), { name: 'Umicore', context: 'dataminded', client: true })
writeDoc(path.join(vault, 'projects/portal.md'), { name: 'Portal', context: 'dataminded' })
writeDoc(path.join(vault, 'tasks/T-0029.md'), { title: 'Review PR', project: '[[portal]]', status: 'review' })
writeDoc(path.join(vault, 'tasks/T-0030.md'), { title: 'Other', project: '[[portal]]', status: 'todo' })
fs.mkdirSync(path.join(vault, 'learning/kubernetes-watches'), { recursive: true })
fs.writeFileSync(path.join(vault, 'learning/kubernetes-watches/MISSION.md'), '# Mission: Kubernetes watches\n\nReview [[T-0029]], and see T-0030.\n')
fs.mkdirSync(path.join(vault, 'learning/empty'))
// Sessions are UTC; the walk is local time, like the clock on the wall.
const at = (local: string) => new Date(local).toISOString()
writeDoc(path.join(vault, 'sessions/s1.md'), { task: '[[T-0029]]', started: at('2026-10-23T08:45:00') })
writeDoc(path.join(vault, 'sessions/s2.md'), { task: '[[T-0404]]', started: at('2026-10-23T09:00:00') })
writeDoc(path.join(vault, 'sessions/s3.md'), { task: '[[T-0030]]', started: at('2026-10-01T09:00:00') })
writeDoc(path.join(vault, 'sessions/s4.md'), { task: '[[T-0030]]', started: at('2026-10-23T18:00:00') })
writeDoc(path.join(vault, 'meetings/Standup.md'), { date: '2026-10-23', time: '9:30', project: '[[portal]]' })
writeDoc(path.join(vault, 'meetings/Untimed.md'), { date: '2026-10-23' })
writeDoc(path.join(vault, 'inbox/2026-10-23 0955 Idea.md'), { status: 'inbox' })
afterAll(() => { fs.rmSync(vault, { recursive: true, force: true }) })

const now = new Date('2026-10-23T16:00:00')

test('a learning folder is a lake, with a stream to the work its mission names', () => {
  const g = knowledgeGraph(now)
  const lake = g.nodes.find((n) => n.id === 'learning/kubernetes-watches')
  expect(lake).toMatchObject({ kind: 'lake', title: 'Kubernetes watches', contexts: ['dataminded'] })
  expect(g.nodes.find((n) => n.id === 'learning/empty')?.title).toBe('empty')
  expect(g.edges.filter((e) => e.kind === 'stream').map((e) => `${e.a} ${e.b}`).sort())
    .toEqual(['learning/kubernetes-watches tasks/T-0029.md', 'learning/kubernetes-watches tasks/T-0030.md'])
})

test('a project marked client is a client', () => {
  const g = knowledgeGraph(now)
  expect(g.nodes.find((n) => n.id === 'projects/umicore.md')?.client).toBe(true)
  expect(g.nodes.find((n) => n.id === 'projects/portal.md')?.client).toBeUndefined()
})

test('the walk: sessions on known tasks, timed meetings and inbox thoughts of the last week, up to now, in order', () => {
  expect(knowledgeGraph(now).walk).toEqual([
    { at: '2026-10-23T08:45', id: 'tasks/T-0029.md', what: 'session' },
    { at: '2026-10-23T09:30', id: 'meetings/Standup.md', what: 'meeting' },
    { at: '2026-10-23T09:55', id: 'inbox/2026-10-23 0955 Idea.md', what: 'thought' },
  ])
})
