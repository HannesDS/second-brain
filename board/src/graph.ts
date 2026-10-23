// The Brain Terrain graph: every vault doc a node, wikilinks, `project` fields and similar content the edges.
// The server builds it (board/graph.ts); the page filters it and lays it out here.

export const KINDS = ['project', 'task', 'thought', 'meeting', 'report'] as const
export type Kind = (typeof KINDS)[number]
export const KIND_LABEL: Record<Kind, string> = { project: 'Projects', task: 'Tasks', thought: 'Thoughts', meeting: 'Meetings', report: 'Reports' }
export const LINKS = ['link', 'project', 'similar'] as const
export type LinkKind = (typeof LINKS)[number]
export const LINK_LABEL: Record<LinkKind, string> = { link: 'Links', project: 'Project', similar: 'Similar' }

// `id` is the vault path (tasks/T-0001.md). `project` is the project it belongs to, a project's own name for a project.
// `contexts`: its project's, or for a doc outside a project those of the docs it links to.
export type GraphNode = { id: string; kind: Kind; name: string; title: string; project: string; contexts: string[]; status: string }
// Undirected: `a` sorts before `b`. Similar edges carry their score.
export type GraphEdge = { a: string; b: string; kind: LinkKind; score?: number }
export type KnowledgeGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

export type Filter = { context: string; project: string; kinds: Kind[]; links: LinkKind[] }

// Context and project work like the global switch: '' is all, and docs without a known context only show under all.
export function filterGraph(g: KnowledgeGraph, f: Filter): KnowledgeGraph {
  const nodes = g.nodes.filter((n) => f.kinds.includes(n.kind) && (!f.context || n.contexts.includes(f.context)) && (!f.project || n.project === f.project))
  const ids = new Set(nodes.map((n) => n.id))
  return { nodes, edges: g.edges.filter((e) => f.links.includes(e.kind) && ids.has(e.a) && ids.has(e.b)) }
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
