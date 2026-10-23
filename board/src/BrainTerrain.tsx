import { useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, Handle, Position, ReactFlow, useStore, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { KINDS, KIND_LABEL, LINKS, LINK_LABEL, citeParts, filterGraph, edgeState, layout, nodeState, type GraphNode, type Kind, type KnowledgeGraph, type LinkKind, type NodeState } from './graph'
import { CONTEXTS, CONTEXT_LABEL, api, inContext, type Doc, type Vault } from './lib'

type DocData = { node: GraphNode; state: NodeState; open: (n: GraphNode) => void }
type Hit = { path: string; snippet: string }
type Reply = { q: string; answer: string; sources: { path: string; title: string }[] }
type DocNode = Node<DocData, 'doc'>

// A doc is a dot; projects are bigger and always named, the rest show their title once you zoom in or hover.
function DocDot({ data: { node, state, open } }: NodeProps<DocNode>) {
  const close = useStore((s) => s.transform[2] > 1.2)
  return (
    <div className={`kg-node ${node.kind} ${node.status === 'done' ? 'done' : ''} ${state}`} title={node.title} role="button" tabIndex={0}
      aria-label={`${KIND_LABEL[node.kind]}: ${node.title}`} onKeyDown={(e) => e.key === 'Enter' && open(node)}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="kg-dot" aria-hidden />
      {(node.kind === 'project' || close || state === 'hot' || state === 'match') && <span className="kg-label">{node.title}</span>}
      <Handle type="source" position={Position.Top} isConnectable={false} />
    </div>
  )
}

const nodeTypes = { doc: DocDot }

// Brain Terrain: the whole vault as one graph. Filters start at the global context and project, and follow them.
// The search box searches only the docs the filters show (by meaning, or plain text when Ollama is down).
// In Ask mode Claude answers from the best of those docs instead, and the docs it cites light up.
// `vault` is only read to refetch the graph when it changes.
export default function BrainTerrain({ vault, projects, context, scope, open, fail }: {
  vault: Vault; projects: Doc[]; context: string; scope: string; open: (n: GraphNode) => void; fail: (e: Error) => void
}) {
  const [graph, setGraph] = useState<KnowledgeGraph>()
  const [ctx, setCtx] = useState(context)
  const [project, setProject] = useState(scope)
  const [kinds, setKinds] = useState<Kind[]>([...KINDS])
  const [links, setLinks] = useState<LinkKind[]>([...LINKS])
  const [hover, setHover] = useState('')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>()
  const [searchState, setSearchState] = useState<'loading' | 'done' | 'failed'>('done')
  const [mode, setMode] = useState<'search' | 'ask'>('search')
  const [reply, setReply] = useState<Reply>()
  // Bumped by every question and mode switch, so an older answer that arrives late is dropped.
  const asked = useRef(0)
  useEffect(() => { setCtx(context); setProject(scope) }, [context, scope])
  // Refetched whenever the vault changes (`fail` is a new function on every render, so it's left out).
  useEffect(() => { api('graph').then(setGraph, fail) }, [vault])

  const shown = useMemo(() => graph && filterGraph(graph, { context: ctx, project, kinds, links }), [graph, ctx, project, kinds, links])
  const pos = useMemo(() => shown && layout(shown.nodes, shown.edges), [shown])
  // A new list only when the shown docs change, not on every graph refetch.
  const within = useMemo(() => shown?.nodes.map((n) => n.id).join('\n') ?? '', [shown])
  const searching = q.trim().length >= 2
  useEffect(() => {
    if (mode !== 'search' || !searching || !within) { setHits(undefined); setSearchState('done'); return }
    // A slower answer to an earlier query (or other filters) arrives after this cleanup ran, so it's dropped.
    let live = true
    setSearchState('loading')
    const t = setTimeout(() => api('search', 'POST', { q, within: within.split('\n') })
      .then((h) => { if (live) { setHits(h); setSearchState('done') } }, () => { if (live) { setHits(undefined); setSearchState('failed') } }), 200)
    return () => { live = false; clearTimeout(t) }
  }, [q, searching, within, mode])
  if (!shown || !pos) return <main className="kg-page"><p className="muted">Loading the terrain…</p></main>

  const near = new Set(hover ? [hover, ...shown.edges.flatMap((e) => (e.a === hover ? [e.b] : e.b === hover ? [e.a] : []))] : [])
  const byId = new Map(shown.nodes.map((n) => [n.id, n]))
  // Ask lists the docs its answer cites, in the order it first cites them.
  const found = mode === 'search'
    ? hits?.flatMap((h) => (byId.has(h.path) ? [{ node: byId.get(h.path)!, snippet: h.snippet }] : []))
    : reply && [...new Set(citeParts(reply.answer).filter((p) => typeof p === 'number'))]
      .flatMap((n) => (byId.has(reply.sources[n - 1]?.path) ? [{ node: byId.get(reply.sources[n - 1].path)!, snippet: '' }] : []))
  const matches = found && new Set(found.map((f) => f.node.id))
  const nodes: DocNode[] = shown.nodes.map((n) => ({
    id: n.id, type: 'doc', position: pos.get(n.id)!, origin: [0.5, 0.5],
    data: { node: n, state: nodeState(n.id, hover, near, matches), open },
  }))
  const edges: Edge[] = shown.edges.map((e) => ({
    id: `${e.a}\n${e.b}`, source: e.a, target: e.b, type: 'straight',
    className: `${e.kind} ${edgeState(e, hover, matches)}`,
  }))
  const toggle = <T,>(all: T[], set: (v: T[]) => void, v: T) => set(all.includes(v) ? all.filter((x) => x !== v) : [...all, v])
  const switchMode = (m: typeof mode) => { asked.current++; setMode(m); setReply(undefined); setSearchState('done') }
  const ask = () => {
    if (!searching) return
    const n = ++asked.current
    setSearchState('loading')
    api('ask', 'POST', { q, within: within.split('\n') })
      .then((r) => { if (n === asked.current) { setReply({ q: q.trim(), ...r }); setSearchState('done') } }, () => { if (n === asked.current) setSearchState('failed') })
  }
  const cite = (n: number, i: number) => {
    const node = reply && byId.get(reply.sources[n - 1]?.path)
    return node ? (
      <button key={i} className="kg-cite" title={node.title} onClick={() => open(node)} onMouseEnter={() => setHover(node.id)} onMouseLeave={() => setHover('')}
        onFocus={() => setHover(node.id)} onBlur={() => setHover('')}>{n}</button>
    ) : `[${n}]`
  }

  return (
    <main className="kg-page">
      <div className="filter-bar">
        <div className="view-switch" role="group" aria-label="Context">
          {['', ...CONTEXTS].map((c) => (
            <button key={c || 'all'} className={ctx === c ? 'tab on' : 'tab'} aria-pressed={ctx === c}
              onClick={() => { setCtx(c); if (c && project && !inContext(c, projects.find((p) => p.name === project)?.data.context)) setProject('') }}>
              {c ? CONTEXT_LABEL[c] : 'All'}
            </button>
          ))}
        </div>
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projects.filter((p) => inContext(ctx, p.data.context)).map((p) => <option key={p.name} value={p.name}>{p.data.name ?? p.name}</option>)}
        </select>
        <div className="kg-chips" role="group" aria-label="Show">
          {KINDS.map((k) => (
            <button key={k} className={`kg-chip ${k} ${kinds.includes(k) ? 'on' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => toggle(kinds, setKinds, k)}>
              <span className="kg-dot" aria-hidden />{KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="kg-chips" role="group" aria-label="Edges">
          {LINKS.map((l) => (
            <button key={l} className={`kg-chip edge ${l} ${links.includes(l) ? 'on' : ''}`} aria-pressed={links.includes(l)} onClick={() => toggle(links, setLinks, l)}
              title={l === 'similar' ? 'Docs that read alike (local embeddings)' : undefined}>
              <span className="kg-line" aria-hidden />{LINK_LABEL[l]}
            </button>
          ))}
        </div>
        <div className="view-switch" role="group" aria-label="Search mode">
          <button className={mode === 'search' ? 'tab on' : 'tab'} aria-pressed={mode === 'search'} onClick={() => switchMode('search')}>Search</button>
          <button className={mode === 'ask' ? 'tab on' : 'tab'} aria-pressed={mode === 'ask'} onClick={() => switchMode('ask')}
            title="Claude answers from the docs shown and cites them">Ask</button>
        </div>
        <input type="search" className="kg-search" value={q} placeholder={mode === 'ask' ? 'Ask these docs, then Enter…' : 'Search these docs…'}
          aria-label={mode === 'ask' ? 'Ask a question about the docs shown' : 'Search the docs shown'} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); switchMode(mode) } else if (e.key === 'Enter' && mode === 'ask') ask() }} />
        <span className="muted">{shown.nodes.length} docs · {shown.edges.length} links · click to open</span>
      </div>
      {shown.nodes.length ? (
        <div className="kg-body">
          <div className="deps-host kg-host">
            {/* Remounting when the filter changes fits the view to what is left. */}
            <ReactFlow key={`${ctx}|${project}|${kinds.join()}|${links.join()}`} className="deps-flow kg-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes}
              colorMode="system" fitView minZoom={0.1} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} elementsSelectable={false}
              onNodeClick={(_, n) => open((n as DocNode).data.node)} onNodeMouseEnter={(_, n) => setHover(n.id)} onNodeMouseLeave={() => setHover('')}
              proOptions={{ hideAttribution: true }}>
              <Background gap={24} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          {(mode === 'search' ? searching : reply || searchState !== 'done') && (
            <aside className="kg-hits" aria-label={mode === 'ask' ? 'Answer' : 'Search results'}>
              <p className="search-note" role="status">
                {mode === 'ask'
                  ? searchState === 'loading' ? 'Asking Claude…' : searchState === 'failed' ? 'Asking failed, try again' : reply?.answer ? reply.q : `Nothing in these docs about “${reply?.q}”`
                  : searchState === 'loading' ? 'Searching…' : searchState === 'failed' ? 'Search failed, try again' : found?.length ? `${found.length} found` : `Nothing found for “${q.trim()}”`}
              </p>
              {mode === 'ask' && reply?.answer && (
                <p className={searchState === 'loading' ? 'kg-answer stale' : 'kg-answer'}>
                  {citeParts(reply.answer).map((p, i) => (typeof p === 'number' ? cite(p, i) : p))}
                </p>
              )}
              <ul className={searchState === 'loading' ? 'stale' : undefined}>
                {found?.map(({ node, snippet }) => (
                  <li key={node.id}>
                    <button className="kg-hit" onClick={() => open(node)} onMouseEnter={() => setHover(node.id)} onMouseLeave={() => setHover('')}
                      onFocus={() => setHover(node.id)} onBlur={() => setHover('')}>
                      <span className={`kg-kind ${node.kind}`} title={KIND_LABEL[node.kind]}><span className="kg-dot" aria-hidden /></span>
                      <strong>{node.title}</strong>
                      {snippet && <span className="muted">…{snippet}…</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      ) : <p className="muted">Nothing here with these filters.</p>}
    </main>
  )
}
