import { expect, test } from 'vitest'
import { edgeState, filterGraph, hull, layout, mapOf, nodeState, smoothPath, walkOf, type GraphNode, type KnowledgeGraph } from './graph'

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

test('each context is a region, side by side in the order of CONTEXTS, its outline around its hills', () => {
  const nodes: GraphNode[] = []
  const edges: KnowledgeGraph['edges'] = []
  for (const [p, c] of [['a', 'personal'], ['b', 'dataminded'], ['c', 'personal'], ['d', 'dataminded']]) {
    nodes.push(node(`projects/${p}.md`, 'project', p, c))
    for (let i = 0; i < 3; i++) nodes.push(node(`tasks/${p}${i}.md`, 'task', p, c))
  }
  // A strong tie across contexts: the regions still stay apart.
  edges.push({ a: 'tasks/a0.md', b: 'tasks/b0.md', kind: 'link' })
  const m = mapOf({ nodes, edges })
  expect(m.regions.map((r) => r.context)).toEqual(['dataminded', 'personal'])
  const x = (c: string) => m.hills.filter((h) => h.context === c).map((h) => h.x)
  expect(Math.max(...x('dataminded'))).toBeLessThan(Math.min(...x('personal')))
  for (const r of m.regions) {
    for (const h of m.hills.filter((h) => h.context === r.context)) {
      expect(h.x).toBeGreaterThan(Math.min(...r.outline.map((p) => p.x)))
      expect(h.x).toBeLessThan(Math.max(...r.outline.map((p) => p.x)))
    }
  }
  // One context: no region borders.
  expect(mapOf({ nodes: nodes.filter((n) => n.contexts[0] === 'personal'), edges: [] }).regions).toEqual([])
})

test('unfiled thoughts wait in the Clearing below the map; filed thoughts on a hill grow into a wood', () => {
  const nodes: GraphNode[] = [node('projects/a.md', 'project', 'a')]
  for (let i = 0; i < 4; i++) nodes.push({ ...node(`notes/t${i}.md`, 'thought', 'a'), status: 'filed' })
  for (let i = 0; i < 5; i++) nodes.push({ ...node(`inbox/u${i}.md`, 'thought'), status: 'inbox' })
  const m = mapOf({ nodes, edges: [] })
  expect(m.clearing).toMatchObject({ count: 5 })
  const [h] = m.hills
  for (let i = 0; i < 5; i++) {
    const p = m.at.get(`inbox/u${i}.md`)!
    expect(((p.x - m.clearing!.x) / m.clearing!.rx) ** 2 + ((p.y - m.clearing!.y) / m.clearing!.ry) ** 2).toBeLessThan(1)
    expect(p.y).toBeGreaterThan(h.y + h.r)
  }
  expect(m.uncharted).toBeUndefined()
  expect(m.woods).toEqual([expect.objectContaining({ hill: 'projects/a.md', count: 4 })])
  for (let i = 0; i < 4; i++) {
    const p = m.at.get(`notes/t${i}.md`)!
    expect(Math.hypot(p.x - m.woods[0].x, p.y - m.woods[0].y)).toBeLessThan(m.woods[0].r)
  }
})

test("the walk: today's visits in order, repeats merged, thoughts planted between the stops around them, earlier days as tracks", () => {
  const at = new Map([['t1', { x: 0, y: 0 }], ['t2', { x: 100, y: 0 }], ['m', { x: 100, y: 100 }], ['idea', { x: 999, y: 999 }]])
  const byId = new Map([node('t1', 'task', 'a'), node('t2', 'task', 'b'), node('m', 'meeting', 'b'), node('idea', 'thought')].map((n) => [n.id, n]))
  const w = walkOf([
    { at: '2026-10-22T09:00', id: 't1', what: 'session' }, { at: '2026-10-22T10:00', id: 't2', what: 'session' },
    { at: '2026-10-23T08:00', id: 't1', what: 'session' }, { at: '2026-10-23T08:30', id: 't1', what: 'session' },
    { at: '2026-10-23T09:00', id: 'idea', what: 'thought' }, { at: '2026-10-23T10:00', id: 't2', what: 'session' },
    { at: '2026-10-23T11:00', id: 'm', what: 'meeting' }, { at: '2026-10-23T12:00', id: 'gone', what: 'session' },
  ], at, byId, '2026-10-23')
  expect(w.today.map((s) => [s.id, s.hill])).toEqual([['t1', 'a'], ['t2', 'b'], ['m', 'b']])
  // 09:00 is halfway from t1 (08:00) to t2 (10:00), nudged off the line.
  expect(w.planted.get('idea')).toEqual({ x: 60, y: -10 })
  expect(w.earlier).toEqual([[{ x: 0, y: 0 }, { x: 100, y: 0 }]])
})

test('hull and smooth outline', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }]
  expect(hull(square)).toHaveLength(4)
  expect(hull(square)).not.toContainEqual({ x: 5, y: 5 })
  expect(smoothPath(hull(square))).toMatch(/^M.*Z$/)
  expect(smoothPath([{ x: 0, y: 0 }])).toBe('')
})
