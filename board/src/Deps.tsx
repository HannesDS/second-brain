import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { NODE_H, NODE_W, chainOf, edgesOf, layout, linked, openChains } from './chains'
import { LABELS, columnOf, type Agent, type Doc } from './lib'
import { useDark } from './theme'

type TaskData = { task: Doc; focus: boolean; running: boolean; open: (d: Doc) => void }
type LaneData = { label: string }
type TaskNode = Node<TaskData, 'task'>
type LaneNode = Node<LaneData, 'lane'>

// A ticket: status marker, id, status word and title. Pulses while an agent session works on it.
function TaskBox({ data: { task, focus, running, open } }: NodeProps<TaskNode>) {
  const s = columnOf(task)
  return (
    <div className={`dep-node ${s} ${focus ? 'focus' : ''} ${running ? 'running' : ''}`} role="button" tabIndex={0}
      title={running ? 'An agent is working on this' : undefined} onKeyDown={(e) => e.key === 'Enter' && open(task)}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="dep-top"><span className="dep-marker" aria-hidden /><span className="id">{task.name}</span><span className="spacer" /><span className="dep-status">{LABELS[s]}</span></div>
      <div className="dep-title">{task.data.title ?? task.name}</div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function LaneBox({ data }: NodeProps<LaneNode>) {
  return <div className="dep-lane"><span className="dep-lane-label">{data.label}</span></div>
}

const nodeTypes = { task: TaskBox, lane: LaneBox }

// What Board and My day show: the columns, or the chains. `{}` is every chain, `{ focus }` one ticket's.
export type Graph = { focus?: string } | undefined

export function ViewSwitch({ graph, set }: { graph: Graph; set: (g: Graph) => void }) {
  return (
    <div className="view-switch" role="group" aria-label="Show as">
      <button className={graph ? 'tab' : 'tab on'} aria-pressed={!graph} onClick={() => set(undefined)}>Columns</button>
      <button className={graph ? 'tab on' : 'tab'} aria-pressed={!!graph} onClick={() => set({})}>Dependencies</button>
    </div>
  )
}

// Dependency view: tickets left to right in the order they can land, like a commit graph of features.
// With `focus` it shows that ticket's chain; without, every chain in `tasks` (the current scope). `compact`
// is My day: only chains with open work, and the wheel scrolls the page instead of zooming.
export default function Deps({ tasks, all, focus, agents, open, showAll, compact }: {
  tasks: Doc[]; all: Doc[]; focus?: string; agents: Agent[]; open: (d: Doc) => void; showAll: () => void; compact?: boolean
}) {
  const dark = useDark()
  const target = focus ? all.find((t) => t.name === focus) : undefined
  const chained = linked(tasks)
  const chains = tasks.filter((t) => chained.has(t.name))
  const shown = target ? chainOf(all, target.name) : compact ? openChains(chains) : chains
  const running = new Set(agents.filter((a) => a.task && a.state === 'working').map((a) => a.task))
  const { pos, lanes, width, height } = layout(shown)
  const status = new Map(shown.map((t) => [t.name, t.data.status]))
  const nodes: (TaskNode | LaneNode)[] = [
    ...lanes.map((l): LaneNode => {
      const head = all.find((t) => t.name === l.head)
      return {
        id: `lane:${l.lane}`, type: 'lane', position: { x: -20, y: l.y }, style: { width: width + 40, height: l.height },
        data: { label: `${l.head} ${head?.data.title ?? ''}` }, zIndex: -1,
      }
    }),
    ...shown.map((t): TaskNode => ({
      id: t.name, type: 'task', position: pos.get(t.name)!, style: { width: NODE_W, height: NODE_H },
      data: { task: t, focus: t.name === target?.name, running: running.has(t.name), open },
    })),
  ]
  // Dashed while the blocker is still open: the dependent can't land yet.
  const edges: Edge[] = edgesOf(shown).map((e) => ({
    id: `${e.from}>${e.to}`, source: e.from, target: e.to, type: 'smoothstep', className: status.get(e.from) === 'done' ? '' : 'waiting',
  }))

  return (
    <div className="deps">
      <div className="deps-head">
        {target && <><strong>Chain of <span className="id">{target.name}</span></strong><span className="dep-head-title">{target.data.title}</span></>}
        <span className="muted">{target ? 'what it waits on and what waits on it' : compact ? 'chains with open work' : 'every chain in this scope'} · click a ticket to open it</span>
        <div className="spacer" />
        {focus && <button onClick={showAll}>All chains</button>}
      </div>
      {focus && !target && <p className="muted">No ticket {focus}.</p>}
      {!focus && !shown.length && <p className="muted">{chains.length ? 'Every chain here is done.' : 'No tickets wait on each other here yet. Set “Blocked by” on a task to link it.'}</p>}
      {/* Remounting when the set of tickets changes (another chain, project or context) fits the view again.
          The box is as tall as the chains need, up to most of the screen. */}
      {shown.length > 0 && (
        <div className="deps-host" style={{ height: `min(62vh, ${height + 64}px)` }}>
          <ReactFlow key={focus ?? shown.map((t) => t.name).join()} className="deps-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={dark ? 'dark' : 'light'} fitView
            fitViewOptions={{ maxZoom: 1 }} minZoom={0.2} zoomOnScroll={!compact} preventScrolling={!compact} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} elementsSelectable={false}
            onNodeClick={(_, n) => n.type === 'task' && open((n as TaskNode).data.task)} proOptions={{ hideAttribution: true }}>
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
    </div>
  )
}
