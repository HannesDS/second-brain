// The Brain Terrain graph: every vault doc a node, wikilinks, `project` fields and similar content the edges.
// The server builds it (board/graph.ts); the page filters it and draws it as a map, laid out here.
import { CONTEXTS, OPEN_WORK, URGENT } from './lib'

export const KINDS = ['project', 'task', 'thought', 'meeting', 'report', 'lake'] as const
export type Kind = (typeof KINDS)[number]
// A stream runs from a learning folder (a lake) to the work it fed.
export type LinkKind = 'link' | 'project' | 'similar' | 'stream'

// `id` is the vault path (tasks/T-0001.md). `project` is the project it belongs to, a project's own name for a project.
// `contexts`: its project's, or for a doc outside a project those of the docs it links to. `client`: a client project.
// A lake's `status` is 'mission' when its folder has a MISSION.md.
export type GraphNode = { id: string; kind: Kind; name: string; title: string; project: string; contexts: string[]; status: string; priority: string; client?: boolean }
// Undirected: `a` sorts before `b`. Similar edges carry their score.
export type GraphEdge = { a: string; b: string; kind: LinkKind; score?: number }
// One stop on the walk: a session on its task, a meeting, a thought. `at` is local time, YYYY-MM-DDTHH:MM.
export type WalkStep = { at: string; id: string; what: 'session' | 'meeting' | 'thought' }
export type KnowledgeGraph = { nodes: GraphNode[]; edges: GraphEdge[]; walk?: WalkStep[] }

export type Filter = { context: string; kinds: readonly Kind[]; links: readonly LinkKind[] }

// Context works like the global switch: '' is all, and docs without a known context only show under all.
export function filterGraph(g: KnowledgeGraph, f: Filter): KnowledgeGraph {
  const nodes = g.nodes.filter((n) => f.kinds.includes(n.kind) && (!f.context || n.contexts.includes(f.context)))
  const ids = new Set(nodes.map((n) => n.id))
  return { nodes, edges: g.edges.filter((e) => f.links.includes(e.kind) && ids.has(e.a) && ids.has(e.b)), walk: g.walk?.filter((w) => ids.has(w.id)) }
}

export type NodeState = '' | 'hot' | 'near' | 'match' | 'far'

// Hovering a node lights it and its neighbours; otherwise a search (`matches`) lights its hits. The rest fades.
export function nodeState(id: string, hover: string, near: Set<string>, matches?: Set<string>): NodeState {
  if (hover) return id === hover ? 'hot' : near.has(id) ? 'near' : 'far'
  if (matches) return matches.has(id) ? 'match' : 'far'
  return ''
}

// An edge lights up with a hovered end, and stays lit in a search only between two matches.
export function edgeState(e: GraphEdge, hover: string, matches?: Set<string>): '' | 'hot' | 'far' {
  if (hover) return e.a === hover || e.b === hover ? 'hot' : 'far'
  return matches && !(matches.has(e.a) && matches.has(e.b)) ? 'far' : ''
}

// An Ask answer split into text and citations: "[2]" and "[1, 3]" become source numbers (1-based).
export function citeParts(answer: string): (string | number)[] {
  return answer.split(/\[(\d+(?:\s*,\s*\d+)*)\]/).flatMap<string | number>((p, i) => (i % 2 ? p.split(',').map(Number) : p ? [p] : []))
}

export type Point = { x: number; y: number }

// How hard each kind of edge pulls its ends together.
const PULL: Record<LinkKind, number> = { project: 1, link: 0.8, stream: 0.6, similar: 0.4 }
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
// Hills of one context form a region, the contexts side by side. Docs outside a project settle in the lowlands
// next to what they link to (a lake next to the work it fed); unfiled thoughts wait in the Clearing; docs
// linked to nothing are uncharted, in a strip below the map.
export type Hill = { id: string; project: string; title: string; context: string; client: boolean; x: number; y: number; r: number; open: number; docs: number; hot: boolean }
export type Box = { x: number; y: number; w: number; h: number }
export type Region = { context: string; outline: Point[]; label: Point }
export type Clearing = Point & { rx: number; ry: number; count: number }
// Filed thoughts on one hill grow into a wood.
export type Wood = Point & { hill: string; r: number; count: number }
export type TerrainMap = { hills: Hill[]; at: Map<string, Point>; regions: Region[]; woods: Wood[]; clearing?: Clearing; uncharted?: Box; bounds: Box }
// What a hill takes up on the map, its name above it included.
export const hillBox = (h: Hill): Box => ({ x: h.x - h.r, y: h.y - h.r - 50, w: 2 * h.r, h: 2 * h.r + 50 })

const GOLDEN = 2.39996
// Room between hills, also for the name above each one.
const HILL_GAP = 140
const PLACE_GAP = 26
const REGION_PAD = 90
const WOOD_MIN = 3
const elevation = (n: GraphNode) => (n.kind !== 'task' ? 0.92 : OPEN_WORK.includes(n.status) ? 0.28 : n.status === 'done' ? 0.74 : 0.5)
const isOpen = (n: GraphNode) => n.kind === 'task' && n.status !== 'done'
export const unfiled = (n: GraphNode) => n.kind === 'thought' && n.status === 'inbox'

export function mapOf(g: KnowledgeGraph): TerrainMap {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const tops = g.nodes.filter((n) => n.kind === 'project')
  const hillOf = new Map(tops.map((p) => [p.project, p.id]))
  const home = (id: string) => hillOf.get(byId.get(id)?.project ?? '')
  // Unfiled thoughts wait in the Clearing, also when they already name a project.
  const members = new Map(tops.map((p) => [p.id, g.nodes.filter((n) => n.kind !== 'project' && !unfiled(n) && home(n.id) === p.id)]))

  // Hills whose docs link or read alike pull together; then they are pushed apart until none overlap.
  const ties = g.edges.flatMap((e) => {
    const [a, b] = [home(e.a), home(e.b)]
    return a && b && a !== b ? [{ a, b, kind: e.kind }] : []
  })
  const start = layout(tops, ties)
  const hills: Hill[] = tops.map((p) => {
    const mine = members.get(p.id)!
    return {
      id: p.id, project: p.project, title: p.title, context: p.contexts[0] ?? '', client: !!p.client, ...start.get(p.id)!, r: 70 + 24 * Math.sqrt(mine.length),
      open: mine.filter(isOpen).length, docs: mine.length, hot: mine.some((n) => isOpen(n) && URGENT.includes(n.priority)),
    }
  })
  // The force layout spreads a few nodes wide: pull them in to about the area the hills need, then part them.
  const spread = Math.max(1, ...hills.map((h) => Math.hypot(h.x, h.y)))
  const need = 1.3 * Math.sqrt(hills.reduce((s, h) => s + (h.r + HILL_GAP) ** 2, 0))
  for (const h of hills) { h.x *= need / spread; h.y *= need / spread }
  // Each context is a region: its hills keep their shape, the regions sit side by side, in the order of CONTEXTS.
  // Hills without a context stay where the layout put them.
  const contexts = [...new Set(hills.map((h) => h.context))].filter(Boolean).sort((a, b) => order(a) - order(b))
  if (contexts.length > 1) {
    const groups = contexts.map((c) => hills.filter((h) => h.context === c))
    const widths = groups.map((gr) => 2 * Math.max(...gr.map((h) => Math.hypot(h.x - mean(gr, 'x'), h.y - mean(gr, 'y')) + h.r)) + 2 * REGION_PAD)
    let left = -widths.reduce((s, w) => s + w, 0) / 2
    groups.forEach((gr, i) => {
      const [cx, cy] = [mean(gr, 'x'), mean(gr, 'y')]
      for (const h of gr) { h.x += left + widths[i] / 2 - cx; h.y -= cy }
      left += widths[i]
    })
  }
  apart(hills, (h) => h.r + HILL_GAP / 2, 300)

  const at = new Map<string, Point>()
  const woods: Wood[] = []
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
    const trees = members.get(h.id)!.filter((n) => n.kind === 'thought').map((n) => at.get(n.id)!)
    if (trees.length >= WOOD_MIN) {
      const c = { x: mean(trees, 'x'), y: mean(trees, 'y') }
      woods.push({ hill: h.id, ...c, r: Math.max(...trees.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) + 16, count: trees.length })
    }
  }

  // Lowlands: the middle of what a loose doc links to (projectless docs first linked to placed ones),
  // just outside any hill it would land on. Unfiled thoughts skip this: they wait in the Clearing.
  const loose = g.nodes.filter((n) => !at.has(n.id) && !unfiled(n))
  const saplings = g.nodes.filter((n) => !at.has(n.id) && unfiled(n))
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

  // Regions: a smooth outline around each context's hills, drawn only when more than one context is on the map.
  const regions: Region[] = contexts.length > 1 ? contexts.map((c) => {
    const outline = hull(hills.filter((h) => h.context === c).flatMap((h) => Array.from({ length: 16 }, (_, i) => ({
      x: h.x + (h.r + REGION_PAD) * Math.cos((i * Math.PI) / 8), y: h.y + (h.r + REGION_PAD) * Math.sin((i * Math.PI) / 8),
    }))))
    return { context: c, outline, label: { x: mean(outline, 'x'), y: Math.min(...outline.map((p) => p.y)) + 40 } }
  }) : []

  let charted = boxOf([...hills.map(hillBox), ...lowland.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })), ...regions.map((r) => boxOf(r.outline.map((p) => ({ ...p, w: 0, h: 0 }))))])
  let clearing: Clearing | undefined
  if (saplings.length) {
    const rx = Math.max(90, 26 * Math.sqrt(saplings.length) * 1.6)
    const ry = rx * 0.55
    clearing = { x: charted.x + charted.w / 2, y: charted.y + charted.h + 80 + ry, rx, ry, count: saplings.length }
    saplings.sort((a, b) => a.id.localeCompare(b.id)).forEach((n, i) => {
      const f = Math.sqrt((i + 0.5) / saplings.length) * 0.82
      at.set(n.id, { x: clearing!.x + rx * f * Math.cos(i * GOLDEN), y: clearing!.y + ry * f * Math.sin(i * GOLDEN) })
    })
    charted = boxOf([charted, { x: clearing.x - rx, y: clearing.y - ry, w: 2 * rx, h: 2 * ry + 50 }])
  }
  let uncharted: Box | undefined
  if (lost.length) {
    const cols = Math.max(1, Math.floor(Math.max(charted.w, 400) / 90))
    uncharted = { x: charted.x, y: charted.y + charted.h + 100, w: Math.max(charted.w, 400), h: 20 + Math.ceil(lost.length / cols) * 40 }
    lost.forEach((n, i) => at.set(n.id, { x: uncharted!.x + 45 + (i % cols) * 90, y: uncharted!.y + 30 + Math.floor(i / cols) * 40 }))
  }
  return { hills, at, regions, woods, clearing, uncharted, bounds: boxOf(uncharted ? [charted, uncharted] : [charted]) }
}

const order = (c: string) => (CONTEXTS.includes(c) ? CONTEXTS.indexOf(c) : CONTEXTS.length)
const mean = <T extends Point>(ps: T[], k: 'x' | 'y') => ps.reduce((s, p) => s + p[k], 0) / (ps.length || 1)

// Convex hull (monotone chain), counter-clockwise from the leftmost point.
export function hull(points: Point[]): Point[] {
  const ps = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (ps.length < 3) return ps
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (list: Point[]) => {
    const out: Point[] = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    return out.slice(0, -1)
  }
  return [...half(ps), ...half([...ps].reverse())]
}

// A closed, smooth path through the points (Catmull-Rom as cubic Béziers).
export function smoothPath(ps: Point[]) {
  if (ps.length < 3) return ''
  const at = (i: number) => ps[(i + ps.length) % ps.length]
  return ps.map((p, i) => {
    const [a, b, c] = [at(i - 1), at(i + 1), at(i + 2)]
    return `${i ? '' : `M${p.x},${p.y}`} C${p.x + (b.x - a.x) / 6},${p.y + (b.y - a.y) / 6} ${b.x - (c.x - p.x) / 6},${b.y - (c.y - p.y) / 6} ${b.x},${b.y}`
  }).join('') + 'Z'
}

// The walk on the map. Today: sessions and meetings where they are, in time order, each stop knowing its hill
// (a jump to another hill is a context switch). Today's thoughts are planted where the walk was at that time.
// Earlier days are old tracks, one per day.
export type Stop = Point & { at: string; id: string; what: WalkStep['what']; hill: string }
export type Walk = { today: Stop[]; planted: Map<string, Point>; earlier: Point[][] }

export function walkOf(steps: WalkStep[], at: Map<string, Point>, byId: Map<string, GraphNode>, today: string): Walk {
  const stop = (s: WalkStep): Stop | undefined => {
    const p = at.get(s.id)
    return p && { ...p, at: s.at, id: s.id, what: s.what, hill: byId.get(s.id)?.project ?? '' }
  }
  const days = new Map<string, WalkStep[]>()
  for (const s of steps) days.set(s.at.slice(0, 10), [...(days.get(s.at.slice(0, 10)) ?? []), s])
  const visits = (list: WalkStep[]) => list.filter((s) => s.what !== 'thought').flatMap((s) => stop(s) ?? [])
    // Two sessions in a row on one task are one stop.
    .filter((s, i, all) => !i || all[i - 1].id !== s.id)
  const todays = visits(days.get(today) ?? [])
  const planted = new Map<string, Point>()
  for (const s of (days.get(today) ?? []).filter((x) => x.what === 'thought')) {
    const next = todays.findIndex((v) => v.at > s.at)
    const [a, b] = [todays[next < 0 ? todays.length - 1 : Math.max(0, next - 1)], todays[next < 0 ? todays.length - 1 : next]]
    if (!a) continue
    const span = minutes(b.at) - minutes(a.at)
    const f = span > 0 ? Math.min(1, Math.max(0, (minutes(s.at) - minutes(a.at)) / span)) : 0
    // Off the line a little, so the tree doesn't sit on the walk.
    planted.set(s.id, { x: a.x + (b.x - a.x) * f + 10, y: a.y + (b.y - a.y) * f - 10 })
  }
  const earlier = [...days.keys()].filter((d) => d < today).sort().map((d) => visits(days.get(d)!).map(({ x, y }) => ({ x, y }))).filter((t) => t.length > 1)
  return { today: todays, planted, earlier }
}
// Which stops get their time, like spot heights: the start, the end and arrivals on a new hill first, then
// every other stop where its label doesn't cover one already placed. `k` is the zoom, `mark` the symbol size.
export function timedStops(stops: Stop[], k: number, mark: number): Set<number> {
  const out = new Set<number>()
  const taken: Box[] = []
  const prio = (i: number) => (i === 0 || i === stops.length - 1 ? 0 : stops[i - 1].hill !== stops[i].hill ? 1 : 2)
  for (const i of stops.map((_, i) => i).sort((a, b) => prio(a) - prio(b) || a - b)) {
    const s = stops[i]
    const box = { x: s.x + mark * 0.8, y: s.y - 18 / k, w: (prio(i) ? 40 : 110) / k, h: 16 / k }
    if (taken.some((t) => box.x < t.x + t.w && t.x < box.x + box.w && box.y < t.y + t.h && t.y < box.y + box.h)) continue
    taken.push(box)
    out.add(i)
  }
  return out
}
const minutes = (at: string) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16))

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
