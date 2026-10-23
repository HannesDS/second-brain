import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, Maximize, Minus, Plus, Search, X } from 'lucide-react'
import { BLOB } from './Landscape'
import { step } from './combobox'
import {
  KINDS, edgeState, filterGraph, hillBox, mapOf, nodeState, smoothPath, timedStops, unfiled, walkOf,
  type Box, type GraphEdge, type GraphNode, type Hill, type Kind, type KnowledgeGraph, type LinkKind, type Point,
} from './graph'
import { load as loadLocal, save as saveLocal } from './Home'
import { IconButton } from './ui'
import { CONTEXT_LABEL, LABELS, OPEN_WORK, api, isActive, todayISO, type Agent, type Vault } from './lib'

type View = { x: number; y: number; k: number }
type PlaceKind = Exclude<Kind, 'project'>
const MIN_K = 0.12
const MAX_K = 4
// Below this zoom a place shows its name only when you point at it, pick it, or it is on a trail from there.
const NAMES_AT = 1.3
// A hill gets one contour per open task, up to this many; every third is an index contour.
const MAX_CONTOURS = 16
// The walk draws itself in about this many seconds, after a short pause on load.
const WALK_TIME = 4
const WALK_DELAY = 0.3
const short = (t: string) => (t.length > 34 ? `${t.slice(0, 32)}…` : t)
// Which names win when they would overlap: what you look at, then open work, then notes, then done work.
const rank = (n: GraphNode) => (n.kind !== 'task' ? 2 : n.status === 'done' ? 3 : OPEN_WORK.includes(n.status) ? 0 : 1)
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
// Overlays sit on the map: a press or click on them must not pan the map or clear what you picked.
const stopMap = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: (e: React.MouseEvent) => e.stopPropagation() }
const time = (at: string) => at.slice(11, 16)

const PLACE_LABEL: Record<PlaceKind, string> = { task: 'Task', thought: 'Thought', meeting: 'Meeting', report: 'Report', lake: 'Lake' }
// What the key can hide or show, each on its own: hills, every kind of place, trails, your day and agents.
const LAYERS = ['hills', 'task', 'thought', 'meeting', 'report', 'lake', 'link', 'similar', 'walk', 'agents'] as const
type Layer = (typeof LAYERS)[number]
// The map key (docs/MAP-STYLE.md). Each row hides or shows that kind of place.
const LEGEND: [PlaceKind, string, string][] = [
  ['task', 'wip', 'Tasks: waypoint, camp, pass, closed, summit'], ['thought', 'tree', 'Thoughts: trees, unfiled ones saplings'],
  ['meeting', 'hut', 'Meetings: huts'], ['report', 'view', 'Teach reports: viewpoints'], ['lake', 'lake', 'Learning: lakes'],
]

// The symbol a place is drawn with (MAP-STYLE.md, "What is what"). Ready and unknown statuses are to do.
const symbolOf = (n: GraphNode) => (n.kind === 'task' ? (['wip', 'review', 'blocked', 'done'].includes(n.status) ? n.status : 'todo')
  : n.kind === 'thought' ? (unfiled(n) ? 'sapling' : 'tree') : n.kind === 'meeting' ? 'hut' : n.kind === 'report' ? 'view' : 'lake')

// The map's symbols on a 12x12 grid, hairline, coloured by the map tokens. The only copy: docs/MAP-STYLE.md points here.
function Symbols() {
  return <>
    <symbol id="s-todo" viewBox="0 0 12 12"><circle className="bt-s ground note" cx="6" cy="6" r="3" strokeWidth="1.1" /></symbol>
    <symbol id="s-wip" viewBox="0 0 12 12"><circle className="bt-s wood-fill ground-line" cx="6" cy="6" r="3.6" strokeWidth="1" /></symbol>
    <symbol id="s-review" viewBox="0 0 12 12"><path className="bt-s water" d="M3.4 1.8c2.1 2.2 2.1 6.2 0 8.4M8.6 1.8c-2.1 2.2-2.1 6.2 0 8.4" fill="none" strokeWidth="1.3" /></symbol>
    <symbol id="s-blocked" viewBox="0 0 12 12"><path className="bt-s trail" d="M3 3l6 6M9 3 3 9" strokeWidth="1.6" /></symbol>
    <symbol id="s-done" viewBox="0 0 12 12"><path className="bt-s ink" d="M6 1.2v8.2M3.4 3.8h5.2M3.6 10.8h4.8" strokeWidth="1.2" /></symbol>
    <symbol id="s-tree" viewBox="0 0 12 12"><circle className="bt-s ground wood" cx="6" cy="4.8" r="2.9" strokeWidth="1.1" /><path className="bt-s wood" d="M6 7.7v3.3" strokeWidth="1.1" /></symbol>
    <symbol id="s-sapling" viewBox="0 0 12 12"><path className="bt-s faint" d="M6 10.6V5.2M6 7 3.9 5M6 6 8.1 4" fill="none" strokeWidth="1" /></symbol>
    <symbol id="s-hut" viewBox="0 0 12 12"><path className="bt-s ink" d="M1.6 6.2 6 2.4l4.4 3.8" fill="none" strokeWidth="1.2" /><rect className="bt-s ink-fill" x="3" y="6" width="6" height="4.4" /></symbol>
    <symbol id="s-view" viewBox="0 0 12 12"><path className="bt-s water-ink" d="M6 10 2 4.6M6 10 4.2 3M6 10V2.6M6 10 7.8 3M6 10l4-5.4" strokeWidth=".9" /><circle className="bt-s water-ink-fill" cx="6" cy="10" r="1.3" /></symbol>
    <symbol id="s-lake" viewBox="0 0 12 12"><path className="bt-lake" d="M1.4 6.4C1.6 3.4 5 2.6 7.8 3s3.4 2.4 2.6 4.2-4.2 2.4-6.4 2S1.3 7.6 1.4 6.4Z" /><path className="bt-s water" d="M3.6 5.6c1.6-.8 3.4-.8 5 0" fill="none" strokeWidth=".6" /></symbol>
    <symbol id="s-peak" viewBox="0 0 12 12"><path className="bt-s ink-fill" d="M6 2.5 10.2 9.8H1.8Z" /></symbol>
    <symbol id="s-peak-hot" viewBox="0 0 12 12"><path className="bt-s walk-fill" d="M6 2.5 10.2 9.8H1.8Z" /></symbol>
    <symbol id="s-agent" viewBox="0 0 12 12"><rect className="bt-s water-fill" x="3" y="3" width="6" height="6" rx="1.2" /></symbol>
    <symbol id="s-start" viewBox="0 0 12 12"><circle className="bt-s ground walk" cx="6" cy="6" r="3.4" strokeWidth="1.6" /></symbol>
    <symbol id="s-here" viewBox="0 0 12 12"><circle className="bt-s walk-fill ground-line" cx="6" cy="6" r="3.6" strokeWidth="1.4" /></symbol>
  </>
}

// A symbol `s` world units across, centred on (0, 0).
const Sym = ({ id, s }: { id: string; s: number }) => <use href={`#s-${id}`} x={-s / 2} y={-s / 2} width={s} height={s} />

// A trail between two places: a gentle curve, always bending the same way, never far off the straight line.
const trailPath = (a: Point, b: Point) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const bend = Math.min(0.18, 40 / (Math.hypot(dx, dy) || 1))
  return `M${a.x},${a.y} Q${(a.x + b.x) / 2 - dy * bend},${(a.y + b.y) / 2 + dx * bend} ${b.x},${b.y}`
}

// Brain Terrain: the vault as a survey map (docs/MAP-STYLE.md). Projects are hills in their context's region,
// their docs sit on the slopes, links are trails, and today's sessions are the walk.
// It follows the global context; the global project is where the map flies to.
// `vault` is only read to refetch the map when the vault changes.
export default function BrainTerrain({ vault, context, scope, agents, open, fail }: {
  vault: Vault; context: string; scope: string; agents: Agent[]; open: (n: GraphNode) => void; fail: (e: Error) => void
}) {
  const [graph, setGraph] = useState<KnowledgeGraph>()
  // Remembered in this browser, so a layer you hid stays hidden.
  const [layers, setLayersState] = useState<Layer[]>(() => loadLocal<string[]>('sb.terrainLayers', [...LAYERS]).filter((l): l is Layer => LAYERS.includes(l as Layer)))
  const setLayers = (l: Layer[]) => { setLayersState(l); saveLocal('sb.terrainLayers', l) }
  const kinds = useMemo(() => KINDS.filter((k) => k === 'project' || layers.includes(k)), [layers])
  const links = useMemo(() => (['link', 'similar'] as const).filter((l) => layers.includes(l)), [layers])
  const showing = (l: Layer) => layers.includes(l)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [picked, setPicked] = useState('')
  const [hover, setHover] = useState('')
  // What the search box finds: lit on the map while you type, the rest fades.
  const [matches, setMatches] = useState<Set<string>>()
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const flight = useRef(0)

  // Refetched whenever the vault changes (`fail` is a new function on every render, so it's left out).
  useEffect(() => { api('graph').then(setGraph, fail) }, [vault])
  useEffect(() => {
    const el = host.current
    if (!el) return
    const watch = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  // Laid out with every kind, so hiding one doesn't move the rest.
  const shown = useMemo(() => graph && filterGraph(graph, { context, kinds: KINDS, links: ['link', 'project', 'similar', 'stream'] }), [graph, context])
  const map = useMemo(() => shown && mapOf(shown), [shown])
  const byId = useMemo(() => new Map(shown?.nodes.map((n) => [n.id, n])), [shown])
  const visible = useCallback((id: string) => { const n = byId.get(id); return !!n && (n.kind === 'project' || kinds.includes(n.kind)) }, [byId, kinds])
  // The walk only goes where the key shows places. Read every render, so it moves on at midnight.
  const today = todayISO()
  const walk = useMemo(() => map && shown && walkOf(layers.includes('walk') ? (shown.walk ?? []).filter((w) => visible(w.id)) : [], map.at, byId, today), [map, shown, byId, visible, today, layers])
  // Where a place is drawn: today's thoughts stand on the walk, everything else where the map put it.
  const where = useCallback((id: string) => walk?.planted.get(id) ?? map?.at.get(id), [walk, map])

  const flyTo = useCallback((to: View) => {
    cancelAnimationFrame(flight.current)
    if (reducedMotion()) return setView(to)
    const from = viewRef.current
    const t0 = performance.now()
    const frame = (t: number) => {
      const p = Math.min(1, (t - t0) / 450)
      const e = 1 - (1 - p) ** 3
      setView({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e })
      if (p < 1) flight.current = requestAnimationFrame(frame)
    }
    flight.current = requestAnimationFrame(frame)
  }, [])
  // Leaves room for the search on top and the legend below, so nothing you framed hides behind them.
  const frameBox = useCallback((b: Box, max: number): View => {
    const k = clampK(Math.min(max, (size.w - 120) / (b.w || 1), (size.h - 200) / (b.h || 1)))
    return { k, x: size.w / 2 - (b.x + b.w / 2) * k, y: size.h / 2 + 10 - (b.y + b.h / 2) * k }
  }, [size])

  // A new context or project frames the map again; a vault change keeps you where you are.
  const framed = useRef('')
  useEffect(() => {
    if (!map || !size.w || framed.current === `${context}|${scope}`) return
    const first = !framed.current
    framed.current = `${context}|${scope}`
    const hill = map.hills.find((h) => h.project === scope)
    const to = hill ? frameBox(hillBox(hill), 1.6) : frameBox(map.bounds, 1)
    if (first) setView(to)
    else flyTo(to)
    setPicked(hill?.id ?? '')
  }, [map, size.w, context, scope, frameBox, flyTo])

  // The wheel zooms around the pointer. Added by hand: React's wheel handler can't stop the page from scrolling.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      // Over the card or the legend the wheel scrolls them, not the map.
      if (e.target instanceof Element && e.target.closest('.bt-overlay')) return
      e.preventDefault()
      cancelAnimationFrame(flight.current)
      const r = el.getBoundingClientRect()
      const [mx, my] = [e.clientX - r.left, e.clientY - r.top]
      setView((v) => {
        const k = clampK(v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
        return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) }
      })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) setPicked('') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Dragging pans. A press that barely moves is a click, so picking a place still works.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean }>(undefined)
  const [panning, setPanning] = useState(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    cancelAnimationFrame(flight.current)
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    // The button was let go somewhere we never heard about (outside the window, a system dialog).
    if (d && !e.buttons) return onPointerUp()
    if (!d || (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4)) return
    if (!d.moved) { d.moved = true; setPanning(true); host.current?.setPointerCapture(e.pointerId) }
    setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
  }
  // The click that ends a drag comes after pointerup: forget the drag only after it.
  const onPointerUp = () => { setPanning(false); setTimeout(() => { drag.current = undefined }) }
  const dragged = () => !!drag.current?.moved

  const zoomBy = (f: number) => {
    const k = clampK(view.k * f)
    flyTo({ k, x: size.w / 2 - (size.w / 2 - view.x) * (k / view.k), y: size.h / 2 - (size.h / 2 - view.y) * (k / view.k) })
  }
  const goTo = (id: string) => {
    if (!map) return
    setPicked(id)
    const hill = map.hills.find((h) => h.id === id)
    if (hill) return flyTo(frameBox(hillBox(hill), 1.6))
    const p = where(id)
    if (!p) return
    const k = Math.max(view.k, 1.8)
    flyTo({ k, x: size.w / 2 - p.x * k, y: size.h / 2 - p.y * k })
  }

  const ready = map && shown && walk
  const focus = hover || picked
  // The project you're in: everything off its hill fades, unless you point at it.
  const home = scope && map?.hills.some((h) => h.project === scope) ? scope : ''
  // Who is next to whom: over any edge (a hill and its docs too), and over trails only.
  const [neighbours, trailEnds] = useMemo(() => {
    const all = new Map<string, Set<string>>()
    const trail = new Map<string, Set<string>>()
    for (const e of shown?.edges ?? []) {
      for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) {
        all.set(x, (all.get(x) ?? new Set()).add(y))
        if (e.kind !== 'project') trail.set(x, (trail.get(x) ?? new Set()).add(y))
      }
    }
    return [all, trail]
  }, [shown])
  const nearFocus = useMemo(() => new Set(focus ? [focus, ...(neighbours.get(focus) ?? [])] : []), [focus, neighbours])
  // Pointing beats a search, a search beats the project you're in.
  const stateOf = (id: string) => nodeState(id, focus, nearFocus, matches)
  const faded = (n: GraphNode) => { const st = stateOf(n.id); return st === 'far' || (!st && !!home && n.project !== home) }
  const matchedHills = new Set([...(matches ?? [])].map((id) => byId.get(id)).filter((n) => n?.project).map((n) => `projects/${n!.project}.md`))
  const places = useMemo(() => shown?.nodes.filter((n) => n.kind !== 'project' && kinds.includes(n.kind)) ?? [], [shown, kinds])
  // Trails inside one hill, and the faint similar ones, show only up close or from the place you point at:
  // from afar the map keeps the trails between hills and the lowlands.
  const trails = useMemo(() => {
    const local = (e: GraphEdge) => e.kind === 'similar' || (!!byId.get(e.a)?.project && byId.get(e.a)?.project === byId.get(e.b)?.project)
    return shown?.edges.filter((e) => (e.kind === 'link' || e.kind === 'similar') && links.includes(e.kind) && visible(e.a) && visible(e.b)
      && (!local(e) || view.k >= NAMES_AT || e.a === focus || e.b === focus)) ?? []
  }, [shown, byId, visible, links, view.k >= NAMES_AT, focus])
  const streams = shown?.edges.filter((e) => e.kind === 'stream' && visible(e.a) && visible(e.b)) ?? []
  // Symbols shrink slower than the map; names keep their size on screen.
  const markerSize = 13 / Math.sqrt(view.k)
  const px = (n: number) => n / view.k
  const pickedNode = byId.get(picked)
  // Names are placed like on a printed map: most important first, and one that would cover another is left out.
  // Only the zoom changes their boxes, so panning reuses the last placement.
  const named = useMemo(() => {
    const out = new Set<string>()
    if (!map) return out
    // From afar only what you point at, the places its trails lead to and what you searched get a name
    // (pointing at a hill names none). Lakes always carry their name, like water on a map.
    const linked = new Set(focus ? [focus, ...(trailEnds.get(focus) ?? [])] : matches ?? [])
    const taken: Box[] = []
    const candidates = places.filter((n) => view.k >= NAMES_AT || linked.has(n.id) || n.kind === 'lake')
      .sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || Number(linked.has(b.id)) - Number(linked.has(a.id)) || rank(a) - rank(b) || a.id.localeCompare(b.id))
    for (const n of candidates) {
      const p = where(n.id)!
      const w = (short(n.title).length * 6.3 + 6) / view.k
      const box = { x: p.x - w / 2, y: p.y + markerSize / 2, w, h: px(16) }
      if (n.id !== focus && taken.some((t) => box.x < t.x + t.w && t.x < box.x + box.w && box.y < t.y + t.h && t.y < box.y + box.h)) continue
      taken.push(box)
      out.add(n.id)
    }
    return out
  }, [map, places, focus, trailEnds, matches, view.k, where])
  const toggle = (l: Layer) => setLayers(showing(l) ? layers.filter((x) => x !== l) : [...layers, l])
  const allOn = LAYERS.every(showing)
  const row = (l: Layer, mark: React.ReactNode, text: string) => (
    <button key={l} className={`bt-legend-row ${showing(l) ? 'on' : ''}`} aria-pressed={showing(l)} onClick={() => toggle(l)}>{mark}{text}</button>
  )
  const fadeHill = (h: Hill) => (focus ? !nearFocus.has(h.id) : matches ? !(matches.has(h.id) || matchedHills.has(h.id)) : !!home && h.project !== home)
  // Agents on the map: a cable line from the foot of the task's hill up to the task. Waiting ones pulse.
  const cables = map && showing('agents') ? agents.filter((a) => a.task && isActive(a)).flatMap((a) => {
    const id = `tasks/${a.task}.md`
    const [to, hill] = [where(id), map.hills.find((h) => h.project === byId.get(id)?.project)]
    if (!to || !hill || !visible(id)) return []
    const d = Math.hypot(to.x - hill.x, to.y - hill.y)
    const [ux, uy] = d > 1 ? [(to.x - hill.x) / d, (to.y - hill.y) / d] : [0, 1]
    return [{ id: a.id, task: a.task!, waiting: a.state === 'needs-input', from: { x: hill.x + ux * (hill.r + 40), y: hill.y + uy * (hill.r + 40) }, to }]
  }) : []
  const stops = walk?.today ?? []
  const legTime = Math.min(0.5, WALK_TIME / Math.max(1, stops.length - 1))
  // "You are here" only on your real last stop today: in one context the walk can end where you no longer are.
  const lastToday = graph?.walk?.filter((w) => w.what !== 'thought' && w.at.startsWith(today)).at(-1)
  const hereNow = !!stops.length && stops.at(-1)!.id === lastToday?.id
  const timed = useMemo(() => timedStops(stops, view.k, markerSize), [stops, view.k, markerSize])
  const line = (ps: Point[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')

  return (
    <main className="bt-page">
      <div className={`bt-map ${panning ? 'panning' : ''}`} ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onClick={() => !dragged() && setPicked('')}>
        {!ready && <p className="bt-empty muted">Charting the terrain…</p>}
        {ready && size.w > 0 && (
          <svg width={size.w} height={size.h} role="group" aria-label="Map of the vault">
            <defs>
              <path id="bt-blob" d={BLOB} />
              <filter id="bt-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14" /></filter>
              <pattern id="bt-grid" width="240" height="240" patternUnits="userSpaceOnUse"><path className="bt-graticule" d="M240,0 H0 V240" /></pattern>
              <pattern id="bt-wood" width="9" height="9" patternUnits="userSpaceOnUse"><circle className="bt-stipple" cx="2.5" cy="2.5" r="1.1" /><circle className="bt-stipple" cx="7" cy="7" r="1.1" /></pattern>
              <Symbols />
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <rect className="bt-paper" x={map.bounds.x - 4000} y={map.bounds.y - 4000} width={map.bounds.w + 8000} height={map.bounds.h + 8000} />
              <rect x={map.bounds.x - 4000} y={map.bounds.y - 4000} width={map.bounds.w + 8000} height={map.bounds.h + 8000} fill="url(#bt-grid)" />
              {map.regions.map((r) => (
                <g key={r.context} className="bt-region">
                  <path d={smoothPath(r.outline)} />
                  <text x={r.label.x} y={r.label.y} fontSize={px(30)} textAnchor="middle">{(CONTEXT_LABEL[r.context] ?? r.context).toUpperCase()}</text>
                </g>
              ))}
              {map.uncharted && (
                <g className="bt-uncharted">
                  <rect x={map.uncharted.x} y={map.uncharted.y} width={map.uncharted.w} height={map.uncharted.h} rx={22} />
                  <text className="bt-hill-name" x={map.uncharted.x + 12} y={map.uncharted.y - px(8)} fontSize={px(10)}>UNCHARTED</text>
                  <text className="bt-meta" x={map.uncharted.x + 12 + px(96)} y={map.uncharted.y - px(8)} fontSize={px(10.5)}>linked to nothing yet</text>
                </g>
              )}
              {/* One blur for all hillshades, not one per hill. */}
              {showing('hills') && <g filter="url(#bt-soft)">
                {map.hills.map((h) => (
                  <use key={h.id} href="#bt-blob" className={`bt-shade ${fadeHill(h) ? 'far' : ''}`} transform={`translate(${h.x + 16} ${h.y + 20}) rotate(${rotation(h)}) scale(${h.r / 100})`} />
                ))}
              </g>}
              {showing('hills') && map.hills.map((h) => {
                const n = 1 + Math.min(h.open, MAX_CONTOURS - 1)
                return (
                  <g key={h.id} className={`bt-hill ${fadeHill(h) ? 'far' : ''} ${picked === h.id ? 'picked' : ''}`} transform={`translate(${h.x} ${h.y})`}
                    role="button" tabIndex={0} aria-label={`${h.title}: ${h.open} open, ${h.docs} docs`}
                    onClick={(e) => { e.stopPropagation(); if (!dragged()) goTo(h.id) }} onDoubleClick={() => open(byId.get(h.id)!)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(h.id) } }} onPointerEnter={() => setHover(h.id)} onPointerLeave={() => setHover('')}>
                    {h.client && <circle className="bt-enclave" r={h.r + 46} />}
                    <g transform={`rotate(${rotation(h)})`}>
                      {Array.from({ length: n }, (_, k) => (
                        <use key={k} href="#bt-blob" className={`bt-contour h${Math.min(5, Math.floor(k / 2)) + 1} ${k % 3 ? '' : 'index'}`}
                          transform={`scale(${(h.r / 100) * (1 - (k / n) * 0.86)})`} />
                      ))}
                    </g>
                    <Sym id={h.hot ? 'peak-hot' : 'peak'} s={markerSize * 1.1} />
                    <text className="bt-hill-name" y={-h.r - px(20)} fontSize={px(10 + 8 * Math.min(1, h.open / 12))} textAnchor="middle">{h.title.toUpperCase()}</text>
                    <text className="bt-meta" y={-h.r - px(6)} fontSize={px(10.5)} textAnchor="middle">▲ {h.open} open · {h.docs} docs</text>
                    {h.client && <text className="bt-meta enclave" y={h.r + 46 + px(16)} fontSize={px(10.5)} textAnchor="middle">CLIENT ENCLAVE</text>}
                  </g>
                )
              })}
              {kinds.includes('thought') && map.woods.map((w) => (
                <g key={`wood:${w.hill}`} className={`bt-wood ${fadeHill(map.hills.find((h) => h.id === w.hill)!) ? 'far' : ''}`}>
                  <circle cx={w.x} cy={w.y} r={w.r} />
                  {view.k >= 0.6 && <text className="bt-meta wood" x={w.x + w.r * 0.7} y={w.y - w.r * 0.7} fontSize={px(10.5)}>wood · {w.count}</text>}
                </g>
              ))}
              {map.clearing && kinds.includes('thought') && (
                <g className="bt-clearing">
                  <ellipse cx={map.clearing.x} cy={map.clearing.y} rx={map.clearing.rx} ry={map.clearing.ry} />
                  <text className="bt-hill-name" x={map.clearing.x} y={map.clearing.y + map.clearing.ry + px(18)} fontSize={px(10)} textAnchor="middle">THE CLEARING</text>
                  <text className="bt-meta" x={map.clearing.x} y={map.clearing.y + map.clearing.ry + px(32)} fontSize={px(10.5)} textAnchor="middle">{map.clearing.count} unfiled thoughts</text>
                </g>
              )}
              {streams.map((e) => {
                const [a, b] = [where(e.a), where(e.b)]
                return a && b && <path key={`${e.a}\n${e.b}`} className={`bt-stream ${edgeState(e, focus, matches) === 'far' ? 'far' : ''}`} d={trailPath(a, b)} />
              })}
              {trails.map((e) => {
                const [a, b] = [where(e.a), where(e.b)]
                if (!a || !b) return null
                const st = edgeState(e, focus, matches)
                const dim = st === 'far' || (!st && home && ![e.a, e.b].some((id) => byId.get(id)?.project === home))
                return <path key={`${e.a}\n${e.b}\n${e.kind}`} className={`bt-trail ${e.kind} ${st === 'hot' ? 'lit' : dim ? 'far' : ''}`} d={trailPath(a, b)} />
              })}
              {walk.earlier.map((t, i) => <path key={`old${i}`} className="bt-old-track" d={line(t)} />)}
              {cables.map((c) => (
                <g key={c.id} className={`bt-cable ${c.waiting ? 'waiting' : ''}`}>
                  <path d={`M${c.from.x},${c.from.y} L${c.to.x},${c.to.y}`} />
                  <g transform={`translate(${(c.from.x + c.to.x) / 2} ${(c.from.y + c.to.y) / 2})`}>
                    {c.waiting && <circle className="bt-pulse" r={markerSize * 0.5} />}
                    <Sym id="agent" s={markerSize} />
                    {c.waiting && <text className="bt-meta water" x={markerSize} y={px(4)} fontSize={px(10.5)}>agent waiting · {c.task}</text>}
                  </g>
                </g>
              ))}
              {places.map((n) => {
                const p = where(n.id)!
                return (
                  <g key={n.id} className={`bt-place ${n.kind} ${picked === n.id ? 'picked' : ''} ${stateOf(n.id) === 'match' ? 'match' : ''} ${faded(n) ? 'far' : ''}`}
                    transform={`translate(${p.x} ${p.y})`} onClick={(e) => { e.stopPropagation(); if (!dragged()) (picked === n.id ? open(n) : setPicked(n.id)) }} onDoubleClick={() => open(n)}
                    onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover('')}>
                    <title>{n.title}</title>
                    <circle className="bt-hit" r={markerSize * (n.kind === 'lake' ? 1.4 : 0.7)} />
                    <Sym id={symbolOf(n)} s={markerSize * (n.kind === 'lake' ? 2.6 : 1)} />
                    {named.has(n.id) && <text className={n.kind === 'lake' ? 'bt-water-name' : 'bt-place-name'} y={markerSize * (n.kind === 'lake' ? 1 : 0.5) + px(13)} fontSize={px(n.kind === 'lake' ? 12 : 11)} textAnchor="middle">{short(n.title)}</text>}
                  </g>
                )
              })}
              {stops.length > 0 && (
                <g className="bt-walk">
                  <path className="bt-walk-casing" d={line(stops)} />
                  {/* Drawn leg by leg in time order, every leg the same time, so a long jump doesn't eat the whole
                      animation. Keyed by its ends: a leg draws once, and a new one draws itself when it comes. */}
                  {stops.slice(1).map((s, i) => (
                    <path key={`${stops[i].at}${stops[i].id}>${s.at}${s.id}`} className="bt-walk-line" d={line([stops[i], s])} pathLength={1} strokeWidth={px(2.4)}
                      style={{ animationDelay: `${WALK_DELAY + i * legTime}s`, animationDuration: `${legTime}s` }} />
                  ))}
                  {stops.map((s, i) => {
                    const prev = stops[i - 1]
                    const end = i === stops.length - 1
                    const here = end && hereNow
                    // A leg from one hill to another is a context switch: labelled when it's long enough on screen to carry it.
                    const leg = prev && prev.hill && s.hill && prev.hill !== s.hill && Math.hypot(s.x - prev.x, s.y - prev.y) * view.k > 220
                    const angle = prev ? (Math.atan2(s.y - prev.y, s.x - prev.x) * 180) / Math.PI : 0
                    const upright = angle > 90 || angle < -90 ? angle + 180 : angle
                    return (
                      <g key={`${s.at}${s.id}`} className="bt-stop-mark" style={{ animationDelay: `${WALK_DELAY + i * legTime}s` }}>
                        {leg && <text className="bt-meta traverse" fontSize={px(10.5)} textAnchor="middle"
                          transform={`translate(${(s.x + prev.x) / 2} ${(s.y + prev.y) / 2}) rotate(${upright}) translate(0 ${px(-6)})`}>context switch</text>}
                        <g transform={`translate(${s.x} ${s.y})`}>
                          {i === 0 && <Sym id="start" s={markerSize} />}
                          {here && <><circle className="bt-here-pulse" r={markerSize * 0.5} /><Sym id="here" s={markerSize * 1.2} /></>}
                          {!here && i > 0 && <circle className="bt-stop" r={px(3)} />}
                          {here && <text className="bt-hill-name here" x={markerSize} y={px(-2)} fontSize={px(10)}>YOU ARE HERE</text>}
                          {timed.has(i) && <text className="bt-time" x={markerSize * 0.8} y={here ? px(12) : px(-6)} fontSize={px(10.5)}>{time(s.at)}{i === 0 ? ' start' : end && !hereNow ? ' · then elsewhere' : ''}</text>}
                        </g>
                      </g>
                    )
                  })}
                </g>
              )}
            </g>
          </svg>
        )}

        {ready && <>
          <div className="bt-overlay top-left" {...stopMap}><Finder nodes={shown.nodes} go={goTo} found={setMatches} fail={fail} /></div>
          <div className="bt-overlay top-right bt-zoom" {...stopMap}>
            <IconButton icon={Plus} label="Zoom in" onClick={() => zoomBy(1.5)} />
            <IconButton icon={Minus} label="Zoom out" onClick={() => zoomBy(1 / 1.5)} />
            <IconButton icon={Maximize} label="Show the whole map" onClick={() => { setPicked(''); flyTo(frameBox(map.bounds, 1)) }} />
          </div>
          {pickedNode && <Card node={pickedNode} hills={map.hills} edges={shown.edges} byId={byId} open={open} go={goTo} close={() => setPicked('')} />}
          <div className="bt-overlay bottom-left bt-legend" {...stopMap}>
            <div className="bt-legend-head">
              <span className="bt-card-label">Key</span>
              <button className="link" onClick={() => setLayers(allOn ? [] : [...LAYERS])}>{allOn ? 'Hide all' : 'Show all'}</button>
            </div>
            {row('hills', <svg viewBox="-12 -12 24 24" aria-hidden>
              <use href="#bt-blob" className="bt-contour h1 index" transform="scale(.1)" /><use href="#bt-blob" className="bt-contour h3" transform="scale(.06)" />
              <Sym id="peak-hot" s={9} />
            </svg>, 'Hills are projects, a contour per open task; an ochre summit has urgent work')}
            {LEGEND.map(([k, sym, text]) => row(k, <svg viewBox="-9 -9 18 18" aria-hidden><Sym id={sym} s={k === 'lake' ? 18 : 14} /></svg>, text))}
            {(['link', 'similar'] as const).map((l) => row(l, <svg viewBox="0 -4 16 8" aria-hidden><path className={`bt-trail ${l}`} d="M0,0 H16" /></svg>,
              l === 'link' ? 'Marked trails: links between docs' : 'Faint paths: docs that read alike'))}
            {row('walk', <svg viewBox="0 -4 16 8" aria-hidden><path className="bt-walk-casing" d="M1,0 H15" /><path className="bt-walk-line still" d="M1,0 H15" /></svg>,
              "My day: today's walk, old tracks for earlier days")}
            {row('agents', <svg viewBox="-9 -9 18 18" aria-hidden><Sym id="agent" s={14} /></svg>, 'Agents: cable lines, waiting ones pulse')}
          </div>
          <div className="bt-overlay bottom-right bt-compass" aria-hidden>
            <svg viewBox="-28 -40 56 70"><circle r="26" /><path className="rose" d="M0 -22 L5 0 L0 22 L-5 0Z" /><path className="needle" d="M0 -22 L5 0 L-5 0Z" /><text y={-30} textAnchor="middle">N</text></svg>
            <span>{map.hills.length} hills · {places.length} places{stops.length ? ` · ${stops.length} stops today` : ''}</span>
          </div>
        </>}
      </div>
    </main>
  )
}

// Each hill leans its own way, so the map doesn't look stamped.
const rotation = (h: Hill) => ([...h.project].reduce((s, c) => s + c.charCodeAt(0), 0) * 37) % 40 - 20

// Find a place: by meaning (the RAG index) and plain text, within the docs on the map, or by title
// right away while that answer comes. Everything it finds lights up on the map; picking a result flies there.
type Hit = { path: string; snippet: string }
function Finder({ nodes, go, found, fail }: { nodes: GraphNode[]; go: (id: string) => void; found: (ids?: Set<string>) => void; fail: (e: Error) => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [searched, setSearched] = useState<{ q: string; hits: Hit[] }>()
  const id = useId()
  const terms = q.trim().toLowerCase()
  const searching = terms.length >= 2
  // A new list only when the docs on the map change, not on every refetch.
  const within = useMemo(() => nodes.map((n) => n.id).join('\n'), [nodes])
  useEffect(() => {
    if (!searching) return setSearched(undefined)
    // A slower answer to an earlier query arrives after this cleanup ran, so it's dropped.
    let live = true
    const t = setTimeout(() => api('search', 'POST', { q, within: within.split('\n') })
      .then((hits: Hit[]) => { if (live) setSearched({ q, hits }) }, (e: Error) => { if (live) fail(e) }), 200)
    return () => { live = false; clearTimeout(t) }
  }, [q, searching, within])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const hits = useMemo(() => {
    if (!searching) return []
    const titled = nodes.filter((n) => `${n.title} ${n.name}`.toLowerCase().includes(terms))
      .sort((a, b) => Number(b.kind === 'project') - Number(a.kind === 'project') || a.title.localeCompare(b.title))
      .map((n) => ({ n, snippet: '' }))
    const meant = searched?.q === q ? searched.hits.flatMap((h) => (byId.has(h.path) ? [{ n: byId.get(h.path)!, snippet: h.snippet }] : [])) : []
    const seen = new Set<string>()
    return [...titled.filter((x) => x.n.kind === 'project'), ...meant, ...titled].filter((x) => !seen.has(x.n.id) && !!seen.add(x.n.id))
  }, [searching, terms, q, nodes, searched, byId])
  useEffect(() => found(searching ? new Set(hits.map((h) => h.n.id)) : undefined), [hits, searching, found])
  const pick = (n: GraphNode) => { go(n.id); setQ('') }
  const shown = hits.slice(0, 8)
  return (
    <div className="bt-find">
      <Search size={18} strokeWidth={1.8} aria-hidden />
      <input type="search" value={q} placeholder="Find a place on the map…" aria-label="Find a place on the map"
        role="combobox" aria-expanded={shown.length > 0} aria-controls={`${id}-hits`} aria-activedescendant={shown.length ? `${id}-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, e.key === 'ArrowDown' ? 1 : -1, shown.length)) }
          else if (e.key === 'Enter' && shown.length) { e.preventDefault(); pick(shown[Math.max(0, active)].n) }
          else if (e.key === 'Escape') setQ('')
        }} />
      {searching && !shown.length && <p className="bt-hits muted" role="status">{searched?.q === q ? `Nothing on the map about “${q.trim()}”` : 'Searching…'}</p>}
      {shown.length > 0 && (
        <ul id={`${id}-hits`} role="listbox" aria-label={`${hits.length} places found`} className="bt-hits">
          {shown.map(({ n, snippet }, i) => (
            <li key={n.id} id={`${id}-${i}`} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(n)}>
              <span className="bt-hit-kind">{n.kind === 'project' ? 'hill' : n.kind}</span>
              <span className="bt-hit-text">
                <span className="bt-hit-title">{n.title}{n.kind !== 'project' && n.project && <span className="muted"> · {n.project}</span>}</span>
                {snippet && <span className="bt-hit-snippet muted">…{snippet}…</span>}
              </span>
            </li>
          ))}
          {hits.length > shown.length && <li className="bt-hits-more muted" aria-hidden>{hits.length - shown.length} more lit on the map</li>}
        </ul>
      )}
    </div>
  )
}

// What you picked: what it is, where it is, and the trails that leave it.
function Card({ node, hills, edges, byId, open, go, close }: {
  node: GraphNode; hills: Hill[]; edges: GraphEdge[]; byId: Map<string, GraphNode>
  open: (n: GraphNode) => void; go: (id: string) => void; close: () => void
}) {
  // One line per neighbour, links before docs that only read alike.
  const seen = new Set<string>()
  const near = edges.filter((e) => e.kind !== 'project' && (e.a === node.id || e.b === node.id))
    .sort((a, b) => Number(a.kind === 'similar') - Number(b.kind === 'similar'))
    .flatMap((e) => {
      const n = byId.get(e.a === node.id ? e.b : e.a)
      if (!n || seen.has(n.id)) return []
      seen.add(n.id)
      return [{ n, kind: e.kind }]
    })
  const hill = node.kind === 'project' ? hills.find((h) => h.id === node.id) : undefined
  const project = node.kind !== 'project' ? hills.find((h) => h.project === node.project) : undefined
  return (
    <aside className="bt-overlay bt-card" aria-label="Picked place" {...stopMap}>
      <div className="bt-card-head">
        <span className="bt-card-kind">{node.kind === 'project' ? 'Hill' : PLACE_LABEL[node.kind]}{node.kind === 'task' ? ` · ${node.name}` : ''}</span>
        <span className="spacer" />
        <IconButton icon={X} label="Close" onClick={close} />
      </div>
      <h3>{node.title}</h3>
      <p className="muted">
        {hill ? `${hill.open} open · ${hill.docs} docs` : project ? <>On <button className="link" onClick={() => go(project.id)}>{project.title}</button></> : 'In the lowlands, outside any project'}
        {node.kind === 'task' && LABELS[node.status] ? ` · ${LABELS[node.status]}` : ''}
      </p>
      <button className="primary bt-open" onClick={() => open(node)}>{node.kind === 'project' ? 'Open project' : 'Open'}<ArrowRight size={15} strokeWidth={1.8} aria-hidden /></button>
      {near.length > 0 && <>
        <div className="bt-card-label">Trails from here</div>
        <ul className="bt-card-trails">
          {near.slice(0, 10).map(({ n, kind }) => (
            <li key={n.id}><button onClick={() => go(n.id)}><span className={`bt-trail-mark ${kind}`} aria-hidden />{n.title}</button></li>
          ))}
        </ul>
      </>}
    </aside>
  )
}
