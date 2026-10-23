// The Brain Terrain graph: every vault doc a node, wikilinks, `project` fields and similar content the edges.
// The server builds it (board/graph.ts); the page filters it and draws it as a map, laid out here.
import { OPEN_WORK, URGENT, hillRings } from './lib'

export const KINDS = ['project', 'task', 'thought', 'meeting', 'report'] as const
export type Kind = (typeof KINDS)[number]
export type LinkKind = 'link' | 'project' | 'similar'

// `id` is the vault path (tasks/T-0001.md). `project` is the project it belongs to, a project's own name for a project.
// `contexts`: its project's, or for a doc outside a project those of the docs it links to.
export type GraphNode = { id: string; kind: Kind; name: string; title: string; project: string; contexts: string[]; status: string; priority: string }
// Undirected: `a` sorts before `b`. Similar edges carry their score.
export type GraphEdge = { a: string; b: string; kind: LinkKind; score?: number }
export type KnowledgeGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

export type Filter = { context: string; kinds: readonly Kind[]; links: readonly LinkKind[] }

// Context works like the global switch: '' is all, and docs without a known context only show under all.
export function filterGraph(g: KnowledgeGraph, f: Filter): KnowledgeGraph {
  const nodes = g.nodes.filter((n) => f.kinds.includes(n.kind) && (!f.context || n.contexts.includes(f.context)))
  const ids = new Set(nodes.map((n) => n.id))
  return { nodes, edges: g.edges.filter((e) => f.links.includes(e.kind) && ids.has(e.a) && ids.has(e.b)) }
}

export type Point = { x: number; y: number }

// How hard each kind of edge pulls its ends together.
const PULL: Record<LinkKind, number> = { project: 1, link: 0.8, similar: 0.4 }
const GAP = 90
// Pair work per run is capped, so a much bigger vault gets a rougher layout instead of a frozen page.
const BUDGET = 4e6

// Force layout: every node pushes the others away, edges pull, and a weak pull to the middle keeps loose
// nodes close. Starts from a spiral in id order and has no randomness, so the same graph lands the same way.
export function layout(nodes: { id: string }[], edges: GraphEdge[], iterations = 300): Map<string, Point> {
  const ids = [...nodes.map((n) => n.id)].sort()
  const at = new Map(ids.map((id, i) => [id, i]))
  const n = ids.length
  const x = ids.map((_, i) => Math.sqrt(i + 0.5) * GAP * 0.6 * Math.cos(i * 2.4))
  const y = ids.map((_, i) => Math.sqrt(i + 0.5) * GAP * 0.6 * Math.sin(i * 2.4))
  const springs = edges.flatMap((e) => (at.has(e.a) && at.has(e.b) && e.a !== e.b ? [[at.get(e.a)!, at.get(e.b)!, PULL[e.kind]] as const] : []))
  const rounds = Math.max(1, Math.min(iterations, Math.floor(BUDGET / Math.max(1, n * n))))
  for (let r = 0; r < rounds; r++) {
    const heat = GAP * (1 - r / rounds) + 1
    const dx = new Float64Array(n)
    const dy = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ux = x[i] - x[j]
        let uy = y[i] - y[j]
        let d2 = ux * ux + uy * uy
        // Two nodes on the same spot: nudge them apart in a fixed direction.
        if (d2 < 0.01) { ux = 0.1 * ((i % 7) - 3) || 0.1; uy = 0.1; d2 = ux * ux + uy * uy }
        const push = (GAP * GAP) / d2
        dx[i] += ux * push; dy[i] += uy * push
        dx[j] -= ux * push; dy[j] -= uy * push
      }
    }
    for (const [i, j, w] of springs) {
      const ux = x[i] - x[j]
      const uy = y[i] - y[j]
      const pull = (w * Math.hypot(ux, uy)) / GAP
      dx[i] -= ux * pull; dy[i] -= uy * pull
      dx[j] += ux * pull; dy[j] += uy * pull
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= x[i] * 0.02; dy[i] -= y[i] * 0.02
      const len = Math.hypot(dx[i], dy[i]) || 1
      const step = Math.min(len, heat)
      x[i] += (dx[i] / len) * step
      y[i] += (dy[i] / len) * step
    }
  }
  return new Map(ids.map((id, i) => [id, { x: x[i], y: y[i] }]))
}

// The map: every project a hill, sized by how many docs it holds. Its docs sit on its slopes by elevation:
// open work near the summit, to do halfway, done at the foot, thoughts, meetings and reports in the foothills.
// Docs outside a project settle in the lowlands next to what they link to; the ones linked to nothing are
// uncharted, in a strip below the map.
export type Hill = { id: string; project: string; title: string; x: number; y: number; r: number; open: number; docs: number; hot: boolean; rings: string[] }
export type Box = { x: number; y: number; w: number; h: number }
export type TerrainMap = { hills: Hill[]; at: Map<string, Point>; uncharted?: Box; bounds: Box }
// What a hill takes up on the map, its name above it included.
export const hillBox = (h: Hill): Box => ({ x: h.x - h.r, y: h.y - h.r - 50, w: 2 * h.r, h: 2 * h.r + 50 })

const GOLDEN = 2.39996
// Room between hills, also for the name above each one.
const HILL_GAP = 140
const PLACE_GAP = 26
const elevation = (n: GraphNode) => (n.kind !== 'task' ? 0.92 : OPEN_WORK.includes(n.status) ? 0.28 : n.status === 'done' ? 0.74 : 0.5)
const isOpen = (n: GraphNode) => n.kind === 'task' && n.status !== 'done'

export function mapOf(g: KnowledgeGraph): TerrainMap {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const tops = g.nodes.filter((n) => n.kind === 'project')
  const hillOf = new Map(tops.map((p) => [p.project, p.id]))
  const home = (id: string) => hillOf.get(byId.get(id)?.project ?? '')
  const members = new Map(tops.map((p) => [p.id, g.nodes.filter((n) => n.kind !== 'project' && home(n.id) === p.id)]))

  // Hills whose docs link or read alike pull together; then they are pushed apart until none overlap.
  const ties = g.edges.flatMap((e) => {
    const [a, b] = [home(e.a), home(e.b)]
    return a && b && a !== b ? [{ a, b, kind: e.kind }] : []
  })
  const start = layout(tops, ties)
  const hills: Hill[] = tops.map((p) => {
    const mine = members.get(p.id)!
    return {
      id: p.id, project: p.project, title: p.title, ...start.get(p.id)!, r: 70 + 24 * Math.sqrt(mine.length),
      open: mine.filter(isOpen).length, docs: mine.length, rings: hillRings(mine.filter(isOpen).map((n) => n.status)),
      hot: mine.some((n) => isOpen(n) && URGENT.includes(n.priority)),
    }
  })
  // The force layout spreads a few nodes wide: pull them in to about the area the hills need, then part them.
  const spread = Math.max(1, ...hills.map((h) => Math.hypot(h.x, h.y)))
  const need = 1.3 * Math.sqrt(hills.reduce((s, h) => s + (h.r + HILL_GAP) ** 2, 0))
  for (const h of hills) { h.x *= need / spread; h.y *= need / spread }
  apart(hills, (h) => h.r + HILL_GAP / 2, 300)

  const at = new Map<string, Point>()
  for (const h of hills) {
    at.set(h.id, { x: h.x, y: h.y })
    // Each band is a ring of places, every next one a golden angle further, so they never line up.
    const bands = new Map<number, GraphNode[]>()
    for (const n of [...members.get(h.id)!].sort((a, b) => a.id.localeCompare(b.id))) bands.set(elevation(n), [...(bands.get(elevation(n)) ?? []), n])
    for (const [e, list] of bands) {
      list.forEach((n, i) => {
        const r = h.r * e + ((i % 3) - 1) * 9
        at.set(n.id, { x: h.x + r * Math.cos(i * GOLDEN + e * 7), y: h.y + r * Math.sin(i * GOLDEN + e * 7) })
      })
    }
  }

  // Lowlands: the middle of what a loose doc links to (projectless docs first linked to placed ones),
  // just outside any hill it would land on.
  const loose = g.nodes.filter((n) => !at.has(n.id))
  const lowland: (Point & { id: string })[] = []
  const lost: GraphNode[] = []
  for (let pass = 0; pass < 2; pass++) {
    for (const n of loose) {
      if (at.has(n.id)) continue
      const near = g.edges.flatMap((e) => (e.a === n.id ? [e.b] : e.b === n.id ? [e.a] : [])).flatMap((id) => at.get(id) ?? [])
      if (!near.length) { if (pass === 1) lost.push(n); continue }
      const k = lowland.length
      const p = { id: n.id, x: near.reduce((s, q) => s + q.x, 0) / near.length + 20 * Math.cos(k * GOLDEN), y: near.reduce((s, q) => s + q.y, 0) / near.length + 20 * Math.sin(k * GOLDEN) }
      lowland.push(p)
      at.set(n.id, p)
    }
  }
  // Parting the lowland docs can push one back onto a hill, so every round ends by lifting them off.
  for (let round = 0; round < 40; round++) {
    apart(lowland, () => PLACE_GAP / 2, 1)
    for (const p of lowland) {
      for (const h of hills) {
        const d = Math.hypot(p.x - h.x, p.y - h.y) || 1
        if (d < h.r + PLACE_GAP) { p.x = h.x + ((p.x - h.x) / d) * (h.r + PLACE_GAP); p.y = h.y + ((p.y - h.y) / d) * (h.r + PLACE_GAP) }
      }
    }
  }
  for (const p of lowland) at.set(p.id, { x: p.x, y: p.y })

  const charted = boxOf([...hills.map(hillBox), ...lowland.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))])
  let uncharted: Box | undefined
  if (lost.length) {
    const cols = Math.max(1, Math.floor(Math.max(charted.w, 400) / 90))
    uncharted = { x: charted.x, y: charted.y + charted.h + 100, w: Math.max(charted.w, 400), h: 20 + Math.ceil(lost.length / cols) * 40 }
    lost.forEach((n, i) => at.set(n.id, { x: uncharted!.x + 45 + (i % cols) * 90, y: uncharted!.y + 30 + Math.floor(i / cols) * 40 }))
  }
  return { hills, at, uncharted, bounds: boxOf(uncharted ? [charted, uncharted] : [charted]) }
}

// Pushes overlapping circles apart, both halfway, for at most `rounds` rounds (it stops once none overlap).
function apart<T extends Point>(items: T[], radius: (t: T) => number, rounds: number) {
  for (let round = 0; round < rounds; round++) {
    let moved = false
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const [a, b] = [items[i], items[j]]
        const min = radius(a) + radius(b)
        const d = Math.hypot(b.x - a.x, b.y - a.y)
        if (d >= min) continue
        const [ux, uy] = d ? [(b.x - a.x) / d, (b.y - a.y) / d] : [1, 0]
        const push = (min - d) / 2
        a.x -= ux * push; a.y -= uy * push
        b.x += ux * push; b.y += uy * push
        moved = true
      }
    }
    if (!moved) return
  }
}

function boxOf(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
}
