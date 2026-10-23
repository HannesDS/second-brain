import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'

const rag = vi.hoisted(() => ({ similar: vi.fn(() => [] as { a: string; b: string; score: number }[]) }))
vi.mock('../lib/rag.mjs', () => rag)

process.env.SECOND_BRAIN_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'))
const { writeDoc } = await import('../lib/vault.mjs')
const { knowledgeGraph } = await import('./graph')

const vault = process.env.SECOND_BRAIN_VAULT
writeDoc(path.join(vault, 'projects/portal.md'), { name: 'Portal', context: 'dataminded' })
writeDoc(path.join(vault, 'tasks/T-0001.md'), { title: 'Login', project: '[[portal]]', status: 'wip' }, 'See reports/2026-01-01-oauth.html and [[Standup|the standup]].\n')
writeDoc(path.join(vault, 'meetings/Standup.md'), { project: '' }, 'Talked about [[portal]].\n')
writeDoc(path.join(vault, 'inbox/Idea.md'), { status: 'filed', tasks: ['[[T-0001]]'], related: ['[[Standup]]'] }, 'Links to [[nowhere]].\n')
// Typed by hand in Obsidian, unquoted: YAML reads `[[Idea]]` as a list in a list.
fs.writeFileSync(path.join(vault, 'inbox/Loose.md'), '---\nrelated: [[Idea]]\n---\nNo project.\n')
writeDoc(path.join(vault, 'notes/Alone.md'), {}, 'Links to nothing.\n')
fs.mkdirSync(path.join(vault, 'reports'))
fs.writeFileSync(path.join(vault, 'reports/2026-01-01-oauth.html'), '<p>report</p>')
afterAll(() => { fs.rmSync(vault, { recursive: true, force: true }) })

const pairs = (g: ReturnType<typeof knowledgeGraph>) => g.edges.map((e) => `${e.a} ${e.b} ${e.kind}`).sort()

test('every doc kind is a node, with its project and context; outside a project, the context of what it links to', () => {
  const g = knowledgeGraph()
  expect(g.nodes.map((n) => [n.id, n.kind, n.project, n.contexts.join()]).sort()).toEqual([
    ['inbox/Idea.md', 'thought', '', 'dataminded'],
    ['inbox/Loose.md', 'thought', '', ''],
    ['meetings/Standup.md', 'meeting', '', 'dataminded'],
    ['notes/Alone.md', 'thought', '', ''],
    ['projects/portal.md', 'project', 'portal', 'dataminded'],
    ['reports/2026-01-01-oauth.html', 'report', 'portal', 'dataminded'],
    ['tasks/T-0001.md', 'task', 'portal', 'dataminded'],
  ])
  expect(g.nodes.find((n) => n.kind === 'report')?.title).toBe('oauth')
})

test('project fields, wikilinks (frontmatter too) and report paths are undirected edges, one per pair', () => {
  expect(pairs(knowledgeGraph())).toEqual([
    'inbox/Idea.md inbox/Loose.md link',
    'inbox/Idea.md meetings/Standup.md link',
    'inbox/Idea.md tasks/T-0001.md link',
    'meetings/Standup.md projects/portal.md link',
    'meetings/Standup.md tasks/T-0001.md link',
    'projects/portal.md tasks/T-0001.md project',
    'reports/2026-01-01-oauth.html tasks/T-0001.md link',
  ])
})

test('similar docs add an edge only where nothing links them yet, and only between nodes', () => {
  rag.similar.mockReturnValue([
    { a: 'inbox/Idea.md', b: 'projects/portal.md', score: 0.912 },
    { a: 'projects/portal.md', b: 'tasks/T-0001.md', score: 0.95 },
    { a: 'sessions/x.md', b: 'tasks/T-0001.md', score: 0.99 },
  ])
  const g = knowledgeGraph()
  expect(g.edges.filter((e) => e.kind === 'similar')).toEqual([{ a: 'inbox/Idea.md', b: 'projects/portal.md', kind: 'similar', score: 0.91 }])
  expect(g.edges.find((e) => e.b === 'tasks/T-0001.md' && e.a === 'projects/portal.md')?.kind).toBe('project')
})
