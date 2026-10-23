import { expect, test } from 'vitest'
import { filterGraph, layout, type GraphNode, type KnowledgeGraph } from './graph'

const node = (id: string, kind: GraphNode['kind'], project = '', context = ''): GraphNode => ({ id, kind, name: id, title: id, project, contexts: context ? [context] : [], status: '' })
const g: KnowledgeGraph = {
  nodes: [node('projects/a.md', 'project', 'a', 'dataminded'), node('tasks/T-1.md', 'task', 'a', 'dataminded'), node('projects/b.md', 'project', 'b', 'personal'), node('inbox/x.md', 'thought')],
  edges: [
    { a: 'projects/a.md', b: 'tasks/T-1.md', kind: 'project' },
    { a: 'inbox/x.md', b: 'tasks/T-1.md', kind: 'link' },
    { a: 'projects/a.md', b: 'projects/b.md', kind: 'similar', score: 0.9 },
  ],
}
const all = { context: '', project: '', kinds: ['project', 'task', 'thought', 'meeting', 'report'] as const, links: ['link', 'project', 'similar'] as const }
const ids = (x: KnowledgeGraph) => x.nodes.map((n) => n.id)

test('no filter shows everything', () => {
  expect(filterGraph(g, { ...all, kinds: [...all.kinds], links: [...all.links] })).toEqual(g)
})

test('a context hides docs without one, and edges to what is hidden', () => {
  const out = filterGraph(g, { ...all, kinds: [...all.kinds], links: [...all.links], context: 'dataminded' })
  expect(ids(out)).toEqual(['projects/a.md', 'tasks/T-1.md'])
  expect(out.edges.map((e) => e.kind)).toEqual(['project'])
})

test('project, kind and edge filters narrow it', () => {
  expect(ids(filterGraph(g, { ...all, kinds: [...all.kinds], links: [...all.links], project: 'b' }))).toEqual(['projects/b.md'])
  expect(ids(filterGraph(g, { ...all, kinds: ['task', 'thought'], links: [...all.links] }))).toEqual(['tasks/T-1.md', 'inbox/x.md'])
  expect(filterGraph(g, { ...all, kinds: [...all.kinds], links: ['similar'] }).edges).toEqual([g.edges[2]])
})

test('layout is deterministic, finite, and pulls linked docs together', () => {
  const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}` }))
  const edges = [{ a: 'n00', b: 'n29', kind: 'link' as const }]
  const pos = layout(nodes, edges)
  expect(layout(nodes, edges)).toEqual(pos)
  for (const p of pos.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
  const d = (a: string, b: string) => Math.hypot(pos.get(a)!.x - pos.get(b)!.x, pos.get(a)!.y - pos.get(b)!.y)
  const others = nodes.slice(1, -1).map((n) => d('n00', n.id)).sort((x, y) => x - y)
  expect(d('n00', 'n29')).toBeLessThan(others[Math.floor(others.length / 2)])
})

test('a big graph still lays out quickly', () => {
  const nodes = Array.from({ length: 2000 }, (_, i) => ({ id: `n${i}` }))
  const t = performance.now()
  layout(nodes, [])
  expect(performance.now() - t).toBeLessThan(2000)
})
