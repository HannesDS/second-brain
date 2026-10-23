import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, Maximize, Minus, Plus, Search, X } from 'lucide-react'
import { BLOB } from './Landscape'
import { step } from './combobox'
import { KINDS, filterGraph, mapOf, type Box, type GraphNode, type Hill, type Kind, type KnowledgeGraph, type LinkKind } from './graph'
import { IconButton } from './ui'
import { LABELS, api, type Vault } from './lib'

type View = { x: number; y: number; k: number }
type PlaceKind = Exclude<Kind, 'project'>
const MIN_K = 0.12
const MAX_K = 4
// Below this zoom a place shows its name only when you point at it, pick it, or it is on a trail from there.
const NAMES_AT = 1.3
const short = (t: string) => (t.length > 34 ? `${t.slice(0, 32)}…` : t)
// Which names win when they would overlap: what you look at, then open work, then notes, then done work.
const rank = (n: GraphNode) => (n.kind !== 'task' ? 2 : n.status === 'done' ? 3 : ['wip', 'blocked', 'review'].includes(n.status) ? 0 : 1)
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: (e: React.MouseEvent) => e.stopPropagation() }

const PLACE_LABEL: Record<PlaceKind, string> = { task: 'Task', thought: 'Thought', meeting: 'Meeting', report: 'Report' }
const LEGEND: [PlaceKind, string][] = [
  ['task', 'Tasks: in progress near the summit, done at the foot'], ['thought', 'Thoughts'], ['meeting', 'Meetings'], ['report', 'Teach reports'],
]

// A place's map symbol, in world units around (0, 0). Tasks use the design system's status markers.
function Symbol({ kind, status, s }: { kind: PlaceKind; status: string; s: number }) {
  if (kind === 'thought') return <circle className="sym" r={s * 0.5} />
  if (kind === 'meeting') return <path className="sym" d={`M${-s * 0.5},${s * 0.45} V${-s * 0.1} L0,${-s * 0.55} L${s * 0.5},${-s * 0.1} V${s * 0.45} Z`} />
  if (kind === 'report') return <path className="sym" d={`M${-s * 0.35},${s * 0.6} V${-s * 0.6} L${s * 0.5},${-s * 0.35} L${-s * 0.35},${-s * 0.1}`} />
  if (status === 'blocked') return <path className="sym" d={`M0,${-s * 0.55} L${s * 0.55},0 L0,${s * 0.55} L${-s * 0.55},0 Z`} />
  if (['wip', 'review', 'done'].includes(status)) return <path className="sym" d={`M0,${-s * 0.6} L${s * 0.55},${s * 0.45} L${-s * 0.55},${s * 0.45} Z`} />
  return <circle className="sym" r={s * 0.4} />
}

// A trail between two places: a gentle curve, always bending the same way, never far off the straight line.
const trail = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const bend = Math.min(0.18, 40 / (Math.hypot(dx, dy) || 1))
  return `M${a.x},${a.y} Q${(a.x + b.x) / 2 - dy * bend},${(a.y + b.y) / 2 + dx * bend} ${b.x},${b.y}`
}
const hillBox = (h: Hill): Box => ({ x: h.x - h.r, y: h.y - h.r - 40, w: 2 * h.r, h: 2 * h.r + 50 })

// Brain Terrain: the vault as a map. Projects are hills, their docs sit on the slopes, links are trails.
// It follows the global context; the global project is where the map flies to.
// `vault` is only read to refetch the map when the vault changes.
export default function BrainTerrain({ vault, context, scope, open, fail }: {
  vault: Vault; context: string; scope: string; open: (n: GraphNode) => void; fail: (e: Error) => void
}) {
  const [graph, setGraph] = useState<KnowledgeGraph>()
  const [kinds, setKinds] = useState<Kind[]>([...KINDS])
  const [links, setLinks] = useState<LinkKind[]>(['link', 'similar'])
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [picked, setPicked] = useState('')
  const [hover, setHover] = useState('')
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
  const shown = useMemo(() => graph && filterGraph(graph, { context, kinds: KINDS, links: ['link', 'project', 'similar'] }), [graph, context])
  const map = useMemo(() => shown && mapOf(shown), [shown])
  const byId = useMemo(() => new Map(shown?.nodes.map((n) => [n.id, n])), [shown])

  const flyTo = useCallback((to: View) => {
    cancelAnimationFrame(flight.current)
    if (still()) return setView(to)
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
    const k = clampK(Math.min(max, (size.w - 120) / b.w, (size.h - 200) / b.h))
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
    const p = map.at.get(id)
    if (!p) return
    const k = Math.max(view.k, 1.8)
    flyTo({ k, x: size.w / 2 - p.x * k, y: size.h / 2 - p.y * k })
  }

  const ready = map && shown
  const focus = hover || picked
  const nearFocus = new Set(focus && shown ? [focus, ...shown.edges.flatMap((e) => (e.a === focus ? [e.b] : e.b === focus ? [e.a] : []))] : [])
  const visible = (id: string) => { const n = byId.get(id); return !!n && (n.kind === 'project' || kinds.includes(n.kind)) }
  // Trails inside one hill, and the faint similar ones, show only up close or from the place you point at:
  // from afar the map keeps the trails between hills and the lowlands.
  const local = (e: KnowledgeGraph['edges'][number]) => e.kind === 'similar' || (!!byId.get(e.a)?.project && byId.get(e.a)?.project === byId.get(e.b)?.project)
  const trails = shown?.edges.filter((e) => e.kind !== 'project' && links.includes(e.kind) && visible(e.a) && visible(e.b)
    && (!local(e) || view.k >= NAMES_AT || e.a === focus || e.b === focus)) ?? []
  const places = shown?.nodes.filter((n) => n.kind !== 'project' && kinds.includes(n.kind)) ?? []
  // Symbols shrink slower than the map, names keep their size on screen.
  const s = 9 / Math.sqrt(view.k)
  const label = 12 / view.k
  const pickedNode = byId.get(picked)
  // Names are placed like on a printed map: most important first, and one that would cover another is left out.
  const named = new Set<string>()
  if (map) {
    const taken: Box[] = []
    const candidates = places.filter((n) => view.k >= NAMES_AT || nearFocus.has(n.id))
      .sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || Number(nearFocus.has(b.id)) - Number(nearFocus.has(a.id)) || rank(a) - rank(b) || a.id.localeCompare(b.id))
    for (const n of candidates) {
      const p = map.at.get(n.id)!
      const w = (short(n.title).length * 6.3 + 6) / view.k
      const box = { x: p.x - w / 2, y: p.y + s, w, h: label * 1.3 }
      if (n.id !== focus && taken.some((t) => box.x < t.x + t.w && t.x < box.x + box.w && box.y < t.y + t.h && t.y < box.y + box.h)) continue
      taken.push(box)
      named.add(n.id)
    }
  }
  const toggle = <T,>(all: T[], set: (v: T[]) => void, v: T) => set(all.includes(v) ? all.filter((x) => x !== v) : [...all, v])

  return (
    <main className="bt-page">
      <div className={`bt-map ${panning ? 'panning' : ''}`} ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onClick={() => !dragged() && setPicked('')}>
        {!ready && <p className="bt-empty muted">Charting the terrain…</p>}
        {ready && size.w > 0 && (
          <svg width={size.w} height={size.h} role="group" aria-label="Map of the vault">
            <defs>
              <path id="bt-blob" d={BLOB} />
              <pattern id="bt-grid" width="240" height="240" patternUnits="userSpaceOnUse"><path className="bt-graticule" d="M240,0 H0 V240" /></pattern>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <rect x={map.bounds.x - 4000} y={map.bounds.y - 4000} width={map.bounds.w + 8000} height={map.bounds.h + 8000} fill="url(#bt-grid)" />
              {map.uncharted && (
                <g className="bt-uncharted">
                  <rect x={map.uncharted.x} y={map.uncharted.y} width={map.uncharted.w} height={map.uncharted.h} rx={22} />
                  <text x={map.uncharted.x + 12} y={map.uncharted.y - label * 0.6} fontSize={label}>UNCHARTED · linked to nothing yet</text>
                </g>
              )}
              {map.hills.map((h, i) => {
                const rings = [...h.rings].reverse()
                return (
                  <g key={h.id} className={`bt-hill ${focus && !nearFocus.has(h.id) ? 'far' : ''} ${picked === h.id ? 'picked' : ''}`} transform={`translate(${h.x} ${h.y})`}
                    role="button" tabIndex={0} aria-label={`${h.title}: ${h.open} open, ${h.docs} docs`}
                    onClick={(e) => { e.stopPropagation(); if (!dragged()) goTo(h.id) }} onDoubleClick={() => open(byId.get(h.id)!)}
                    onKeyDown={(e) => { if (e.key === 'Enter') goTo(h.id) }} onPointerEnter={() => setHover(h.id)} onPointerLeave={() => setHover('')}>
                    <g transform={`rotate(${((i * 37) % 40) - 20})`}>
                      {[0, 1, 2, 3].map((k) => <use key={`b${k}`} href="#bt-blob" className="ring base" transform={`scale(${(h.r / 100) * (1 - k * 0.1)})`} />)}
                      {rings.map((st, k) => <use key={k} href="#bt-blob" className={`ring ${st}`} transform={`scale(${(h.r / 100) * 0.6 * (1 - (k + 1) / (rings.length + 1.5))})`} />)}
                      <use href="#bt-blob" className={`peak ${h.hot ? 'hot' : ''}`} transform={`scale(${(h.r / 100) * 0.05})`} />
                    </g>
                    <text className="bt-hill-name" y={-h.r - 18 / view.k} fontSize={15 / view.k} textAnchor="middle">{h.title}</text>
                    <text className="bt-hill-meta" y={-h.r - 4 / view.k} fontSize={11 / view.k} textAnchor="middle">{h.open} open · {h.docs} docs</text>
                  </g>
                )
              })}
              {trails.map((e) => {
                const [a, b] = [map.at.get(e.a), map.at.get(e.b)]
                if (!a || !b) return null
                const lit = focus && (e.a === focus || e.b === focus)
                return <path key={`${e.a}\n${e.b}`} className={`bt-trail ${e.kind} ${lit ? 'lit' : focus ? 'far' : ''}`} d={trail(a, b)} />
              })}
              {places.map((n) => {
                const p = map.at.get(n.id)!
                return (
                  <g key={n.id} className={`bt-place ${n.kind} ${n.status} ${picked === n.id ? 'picked' : ''} ${focus && !nearFocus.has(n.id) ? 'far' : ''}`}
                    transform={`translate(${p.x} ${p.y})`} onClick={(e) => { e.stopPropagation(); if (!dragged()) setPicked(n.id) }} onDoubleClick={() => open(n)}
                    onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover('')}>
                    <title>{n.title}</title>
                    <circle className="bt-hit" r={s} />
                    <Symbol kind={n.kind as PlaceKind} status={n.status} s={s} />
                    {named.has(n.id) && <text className="bt-place-name" y={s + label} fontSize={label} textAnchor="middle">{short(n.title)}</text>}
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {ready && <>
          <div className="bt-overlay top-left" {...stop}><Finder nodes={shown.nodes} go={goTo} /></div>
          <div className="bt-overlay top-right bt-zoom" {...stop}>
            <IconButton icon={Plus} label="Zoom in" onClick={() => zoomBy(1.5)} />
            <IconButton icon={Minus} label="Zoom out" onClick={() => zoomBy(1 / 1.5)} />
            <IconButton icon={Maximize} label="Show the whole map" onClick={() => { setPicked(''); flyTo(frameBox(map.bounds, 1)) }} />
          </div>
          {pickedNode && <Card node={pickedNode} hill={map.hills.find((h) => h.id === picked)} edges={shown.edges} byId={byId} open={open} go={goTo} close={() => setPicked('')} />}
          <div className="bt-overlay bottom-left bt-legend" {...stop}>
            <div className="bt-legend-row">
              <svg viewBox="-12 -12 24 24" aria-hidden><use href="#bt-blob" className="ring base" transform="scale(.1)" /><use href="#bt-blob" className="peak hot" transform="scale(.035)" /></svg>
              Hills are projects; an ochre peak has urgent work
            </div>
            {LEGEND.map(([k, text]) => (
              <button key={k} className={`bt-legend-row ${kinds.includes(k) ? 'on' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => toggle(kinds, setKinds, k)}>
                <svg viewBox="-8 -8 16 16" aria-hidden><g className={`bt-place ${k} ${k === 'task' ? 'wip' : ''}`}><Symbol kind={k} status={k === 'task' ? 'wip' : ''} s={11} /></g></svg>
                {text}
              </button>
            ))}
            {(['link', 'similar'] as const).map((l) => (
              <button key={l} className={`bt-legend-row ${links.includes(l) ? 'on' : ''}`} aria-pressed={links.includes(l)} onClick={() => toggle(links, setLinks, l)}>
                <svg viewBox="0 -4 16 8" aria-hidden><path className={`bt-trail ${l}`} d="M0,0 H16" /></svg>
                {l === 'link' ? 'Trails: links between docs' : 'Faint trails: docs that read alike'}
              </button>
            ))}
          </div>
          <div className="bt-overlay bottom-right bt-compass" aria-hidden>
            <svg viewBox="-20 -26 40 46"><path className="needle" d="M0,-16 L5,0 L0,-3 L-5,0 Z" /><path className="tail" d="M0,16 L5,0 L0,3 L-5,0 Z" /><text y={-18} textAnchor="middle">N</text></svg>
            <span>{places.length} places · {map.hills.length} hills</span>
          </div>
        </>}
      </div>
    </main>
  )
}

// Find a place: type part of a title or id, pick a result, and the map flies there.
function Finder({ nodes, go }: { nodes: GraphNode[]; go: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const id = useId()
  const terms = q.trim().toLowerCase()
  const hits = terms.length < 2 ? [] : nodes
    .filter((n) => `${n.title} ${n.name}`.toLowerCase().includes(terms))
    .sort((a, b) => Number(b.kind === 'project') - Number(a.kind === 'project') || a.title.localeCompare(b.title))
    .slice(0, 8)
  const pick = (n: GraphNode) => { go(n.id); setQ('') }
  return (
    <div className="bt-find">
      <Search size={18} strokeWidth={1.8} aria-hidden />
      <input type="search" value={q} placeholder="Find a place on the map…" aria-label="Find a place on the map"
        role="combobox" aria-expanded={hits.length > 0} aria-controls={`${id}-hits`} aria-activedescendant={hits.length ? `${id}-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, e.key === 'ArrowDown' ? 1 : -1, hits.length)) }
          else if (e.key === 'Enter' && hits.length) { e.preventDefault(); pick(hits[Math.max(0, active)]) }
          else if (e.key === 'Escape') setQ('')
        }} />
      {terms.length >= 2 && (
        <ul id={`${id}-hits`} role="listbox" aria-label="Places" className="bt-hits">
          {!hits.length && <li className="muted">Nothing on the map called “{q.trim()}”</li>}
          {hits.map((n, i) => (
            <li key={n.id} id={`${id}-${i}`} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(n)}>
              <span className="bt-hit-kind">{n.kind === 'project' ? 'hill' : n.kind}</span>
              <span className="bt-hit-title">{n.title}</span>
              {n.kind !== 'project' && n.project && <span className="muted">{n.project}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// What you picked: what it is, where it is, and the trails that leave it.
function Card({ node, hill, edges, byId, open, go, close }: {
  node: GraphNode; hill?: Hill; edges: KnowledgeGraph['edges']; byId: Map<string, GraphNode>
  open: (n: GraphNode) => void; go: (id: string) => void; close: () => void
}) {
  const near = edges.filter((e) => e.kind !== 'project' && (e.a === node.id || e.b === node.id))
    .flatMap((e) => { const n = byId.get(e.a === node.id ? e.b : e.a); return n ? [{ n, kind: e.kind }] : [] })
    .sort((a, b) => Number(a.kind === 'similar') - Number(b.kind === 'similar'))
  const project = node.kind !== 'project' && node.project ? byId.get(`projects/${node.project}.md`) : undefined
  return (
    <aside className="bt-overlay bt-card" aria-label="Picked place" {...stop}>
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
