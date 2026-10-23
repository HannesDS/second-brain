import { expect, test } from 'vitest'
import { edgeState, filterGraph, layout, mapOf, nodeState, type GraphNode, type KnowledgeGraph } from './graph'

const node = (id: string, kind: GraphNode['kind'], project = '', context = ''): GraphNode => ({ id, kind, name: id, title: id, project, contexts: context ? [context] : [], status: '', priority: '' })
const g: KnowledgeGraph = {
  nodes: [node('projects/a.md', 'project', 'a', 'dataminded'), node('tasks/T-1.md', 'task', 'a', 'dataminded'), node('projects/b.md', 'project', 'b', 'personal'), node('inbox/x.md', 'thought')],
  edges: [
    { a: 'projects/a.md', b: 'tasks/T-1.md', kind: 'project' },
    { a: 'inbox/x.md', b: 'tasks/T-1.md', kind: 'link' },
    { a: 'projects/a.md', b: 'projects/b.md', kind: 'similar', score: 0.9 },
  ],
}
const all = { context: '', kinds: ['project', 'task', 'thought', 'meeting', 'report'] as const, links: ['link', 'project', 'similar'] as const }
const ids = (x: KnowledgeGraph) => x.nodes.map((n) => n.id)

test('no filter shows everything', () => {
  expect(filterGraph(g, { ...all, kinds: [...all.kinds], links: [...all.links] })).toEqual(g)
})

test('a context hides docs without one, and edges to what is hidden', () => {
  const out = filterGraph(g, { ...all, kinds: [...all.kinds], links: [...all.links], context: 'dataminded' })
  expect(ids(out)).toEqual(['projects/a.md', 'tasks/T-1.md'])
  expect(out.edges.map((e) => e.kind)).toEqual(['project'])
})

test('kind and edge filters narrow it', () => {
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

test('the map: hills never overlap, a project\'s docs sit on its hill, loose docs settle outside the hills', () => {
  const nodes: GraphNode[] = []
  const edges: KnowledgeGraph['edges'] = []
  for (const p of ['a', 'b', 'c']) {
    nodes.push(node(`projects/${p}.md`, 'project', p))
    for (let i = 0; i < 12; i++) {
      nodes.push({ ...node(`tasks/${p}${i}.md`, 'task', p), status: ['wip', 'todo', 'done'][i % 3], priority: p === 'a' && i === 0 ? 'p1' : 'p2' })
      edges.push({ a: `projects/${p}.md`, b: `tasks/${p}${i}.md`, kind: 'project' })
    }
  }
  nodes.push(node('inbox/near.md', 'thought'), node('inbox/lost.md', 'thought'))
  edges.push({ a: 'inbox/near.md', b: 'tasks/a0.md', kind: 'link' })
  const m = mapOf({ nodes, edges })
  expect(mapOf({ nodes, edges })).toEqual(m)

  for (const [i, h] of m.hills.entries()) {
    for (const o of m.hills.slice(i + 1)) expect(Math.hypot(h.x - o.x, h.y - o.y)).toBeGreaterThanOrEqual(h.r + o.r)
    for (const n of nodes.filter((x) => x.kind === 'task' && x.project === h.project)) {
      const p = m.at.get(n.id)!
      expect(Math.hypot(p.x - h.x, p.y - h.y)).toBeLessThanOrEqual(h.r)
    }
  }
  const a = m.hills.find((h) => h.project === 'a')!
  expect(a).toMatchObject({ docs: 12, open: 8, hot: true })
  expect(m.hills.find((h) => h.project === 'b')!.hot).toBe(false)
  // Open work is higher up the hill than done work.
  const dist = (id: string) => Math.hypot(m.at.get(id)!.x - a.x, m.at.get(id)!.y - a.y)
  expect(dist('tasks/a0.md')).toBeLessThan(dist('tasks/a2.md'))

  const near = m.at.get('inbox/near.md')!
  for (const h of m.hills) expect(Math.hypot(near.x - h.x, near.y - h.y)).toBeGreaterThan(h.r)
  expect(m.uncharted).toBeDefined()
  const lost = m.at.get('inbox/lost.md')!
  expect(lost.y).toBeGreaterThan(m.uncharted!.y)
  expect(m.bounds.y + m.bounds.h).toBeGreaterThanOrEqual(lost.y)
})

test('many loose docs around one hill all end up off it', () => {
  const nodes: GraphNode[] = [node('projects/a.md', 'project', 'a'), node('tasks/a1.md', 'task', 'a')]
  const edges: KnowledgeGraph['edges'] = [{ a: 'projects/a.md', b: 'tasks/a1.md', kind: 'project' }]
  for (let i = 0; i < 40; i++) {
    nodes.push(node(`inbox/t${i}.md`, 'thought'))
    edges.push({ a: `inbox/t${i}.md`, b: 'tasks/a1.md', kind: 'link' })
  }
  const m = mapOf({ nodes, edges })
  const [h] = m.hills
  for (let i = 0; i < 40; i++) {
    const p = m.at.get(`inbox/t${i}.md`)!
    expect(Math.hypot(p.x - h.x, p.y - h.y)).toBeGreaterThan(h.r)
  }
})

test('an empty map has no hills and a finite frame', () => {
  const m = mapOf({ nodes: [], edges: [] })
  expect(m.hills).toEqual([])
  expect(Object.values(m.bounds).every(Number.isFinite)).toBe(true)
})

test('hover beats search; a search lights its matches and fades the rest', () => {
  const near = new Set(['a', 'b'])
  expect(['a', 'b', 'c'].map((id) => nodeState(id, 'a', near, new Set(['c'])))).toEqual(['hot', 'near', 'far'])
  expect(['a', 'c'].map((id) => nodeState(id, '', new Set(), new Set(['c'])))).toEqual(['far', 'match'])
  expect(nodeState('a', '', new Set())).toBe('')
})

test('an edge stays lit in a search only between two matches', () => {
  const e = { a: 'a', b: 'b', kind: 'link' as const }
  expect([edgeState(e, 'a'), edgeState(e, 'c'), edgeState(e, '', new Set(['a'])), edgeState(e, '', new Set(['a', 'b'])), edgeState(e, '')]).toEqual(['hot', 'far', 'far', '', ''])
})
