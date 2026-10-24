import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, getFirstCollision, pointerWithin, rectIntersection, useDroppable, useSensor,
  useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Ban, Bot, GitPullRequest, Pin, Play, Rocket, Workflow } from 'lucide-react'
import { STATE_LABEL, type Actions } from './Today'
import { PICKUP_PX, aim, dragOver, dropMoves, leftPickup, rebase, type Layout, type Sticky } from './drag'
import { IconButton, IconLink } from './ui'
import { blockersOf, linked } from './chains'
import { LABELS, STATUSES, agentByTask, api, byFinished, byOrder, ago, columnOf, isActive, isFocus, prioLabel, starred, todayISO, unlink, type Agent, type Doc, type Vault } from './lib'

// The board: drag between columns to change status, within a column to reorder. Used full-size on the
// Board page and trimmed on My day (fewer columns, `limit` cards each), so both show the same thing.
export default function BoardColumns({ tasks, vault, agents, drop, fail, act, statuses = STATUSES, limit, more }: {
  tasks: Doc[]; vault: Vault; agents: Agent[]; drop: (v: Vault, write: Promise<unknown>) => Promise<void>; fail: (e: Error) => void; act: Actions
  statuses?: string[]; limit?: number; more?: () => void
}) {
  const projects = useMemo(() => Object.fromEntries(vault.projects.map((p) => [p.name, p])), [vault.projects])
  const byName = useMemo(() => Object.fromEntries(tasks.map((t) => [t.name, t])), [tasks])
  // Where a card goes in a column that isn't Done, which ignores pins. Made anew only when the vault
  // changes, so the groups cached while aiming last the whole drag.
  const stars = useMemo(() => new Set(vault.tasks.filter((t) => starred(t.data)).map((t) => t.name)), [vault.tasks])
  const isStarred = useCallback((id: string) => stars.has(id), [stars])
  const chained = useMemo(() => linked(vault.tasks), [vault.tasks])
  const working = useMemo(() => agentByTask(agents), [agents])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [active, setActive] = useState<Doc>()
  const hasUnknown = statuses === STATUSES && tasks.some((t) => columnOf(t) === '?')
  const cols = useMemo(() => (hasUnknown ? [...statuses, '?'] : statuses), [statuses, hasUnknown])
  const layout = useMemo(() => {
    const docs: Record<string, Doc[]> = Object.fromEntries(cols.map((s) => [s, []]))
    for (const t of tasks) docs[columnOf(t)]?.push(t)
    // Pinned tasks sit at the top of their column; Done shows the latest finished first.
    for (const [s, c] of Object.entries(docs)) c.sort(s === 'done' ? byFinished : (a, b) => Number(isFocus(b)) - Number(isFocus(a)) || byOrder(a, b))
    return Object.fromEntries(Object.entries(docs).map(([s, c]) => [s, c.map((t) => t.name)])) as Layout
  }, [tasks, cols])
  // While dragging, the board shows where the card would land; the drop clears it.
  const [preview, setPreviewState] = useState<Layout>()
  // The preview as of the last drag event, ahead of React's render, so quick moves build on each other.
  const live = useRef<Layout>(undefined)
  const setPreview = (l?: Layout) => { live.current = l; setPreviewState(l) }
  const shownLayout = preview ?? layout
  // The vault reloaded mid-drag (an agent, Obsidian): carry the preview over, so the drop works from the
  // columns as they are. The layout is also rebuilt on renders that changed nothing; then nothing moves.
  useEffect(() => {
    if (!live.current) return
    const next = rebase(live.current, layout, sticky.current.active, sticky.current.home)
    if (next !== live.current) setPreview(next)
  }, [layout])

  // Auto-scroll waits until the card left the spot it was picked up (see leftPickup).
  const [scrolling, setScrolling] = useState(false)
  const leftSpot = useRef(false)
  const autoScroll = useMemo(() => ({ canScroll: () => leftSpot.current }), [])
  // The card in hand looks hovered if the card was hovered when picked up (a mouse or pen, not a finger).
  const [hovered, setHovered] = useState(false)

  const sticky = useRef<Sticky & { home: string }>({ justMoved: false, active: '', home: '' })
  useEffect(() => { requestAnimationFrame(() => { sticky.current.justMoved = false }) }, [preview])
  const collision = useCallback<CollisionDetection>((args) => {
    const hits = pointerWithin(args)
    const hit = getFirstCollision(hits.length ? hits : rectIntersection(args), 'id')
    const nearest = (cards: Set<string>) => {
      const id = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => cards.has(String(c.id))) })[0]?.id
      return id == null ? undefined : String(id)
    }
    const target = aim(hit == null ? undefined : String(hit), live.current ?? layout, nearest, sticky.current, isStarred)
    return target === undefined ? [] : [{ id: target }]
  }, [layout, isStarred])

  // Where a card dropped into Done lands: Done sorts by when a task was finished, and it's finished today.
  const doneAt = (target: string[], id: string) => {
    const t = byName[id]
    const finished = t && { ...t, data: { ...t.data, completed: todayISO() } }
    const i = finished ? target.findIndex((x) => byName[x] && byFinished(finished, byName[x]) < 0) : 0
    return i < 0 ? target.length : i
  }

  function onDragOver({ active: a, over }: DragOverEvent) {
    if (!over) return
    const now = live.current ?? layout
    const next = dragOver(now, String(a.id), String(over.id), limit, isStarred, doneAt)
    if (next === now) return
    sticky.current.justMoved = true
    setPreview(next)
  }

  function onDragEnd({ active: a, over }: DragEndEvent) {
    const moves = over ? dropMoves(layout, live.current ?? layout, String(a.id), String(over.id), (id) => byName[id]?.data ?? {}, limit, isStarred) : []
    setActive(undefined)
    setPreview(undefined)
    if (!moves.length) return
    const from = byName[a.id]?.data.status
    const patch = Object.fromEntries(moves.map((m) => [m.id, m.status === 'done' && from !== 'done' ? { ...m, completed: todayISO() } : m]))
    const write = api('move', 'POST', moves)
    write.catch(fail)
    drop({ ...vault, tasks: vault.tasks.map((t) => patch[t.name] ? { ...t, data: { ...t.data, ...patch[t.name] } } : t) }, write).catch(fail)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd} onDragOver={onDragOver} autoScroll={scrolling && autoScroll}
      onDragMove={({ delta }) => {
        leftSpot.current ||= leftPickup(delta)
        if (!scrolling && leftPickup(delta, PICKUP_PX / 2)) setScrolling(true)
      }}
      onDragStart={(e) => { setScrolling(false); leftSpot.current = false; setHovered(!!(e.activatorEvent.target as Element | null)?.closest('.card')?.matches(':hover')); setActive(byName[e.active.id]); setPreview(layout); sticky.current = { justMoved: false, active: String(e.active.id), home: columnOf(byName[e.active.id]) } }}
      onDragCancel={() => { setActive(undefined); setPreview(undefined) }}>
      <div className="board" style={{ gridTemplateColumns: limit ? `repeat(${cols.length}, minmax(0, 1fr))` : undefined }}>
        {cols.map((s) => {
          // A task can vanish mid-drag when the vault reloads; the preview may still name it.
          const all = shownLayout[s].map((id) => byName[id]).filter(Boolean)
          const shown = limit ? all.slice(0, limit) : all
          return (
            <Column key={s} status={s} count={all.length}>
              <SortableContext items={shown.map((t) => t.name)} strategy={verticalListSortingStrategy}>
                {shown.map((t) => <SortableCard key={t.name} task={t} project={projects[unlink(t.data.project)]} act={act} chained={chained.has(t.name)} agent={working.get(t.name)} />)}
              </SortableContext>
              {all.length > shown.length && <button className="more" onClick={more}>+{all.length - shown.length} more on the Board</button>}
            </Column>
          )
        })}
      </div>
      {/* The card in hand looks exactly like the hovered card you picked up, so nothing shifts under the pointer.
          It lives on <body>: dnd-kit places it in window coordinates, which a transformed view would offset. */}
      {createPortal(<DragOverlay>{active && <Card task={active} project={projects[unlink(active.data.project)]} act={act} chained={chained.has(active.name)} agent={working.get(active.name)} inHand={hovered ? 'lifted' : 'held'} />}</DragOverlay>, document.body)}
    </DndContext>
  )
}

function Column({ status, count, children }: { status: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` })
  return (
    <section className={`column ${isOver ? 'over' : ''}`} ref={setNodeRef} data-status={status}>
      <h2>{LABELS[status]} <span className="count">{count}</span></h2>
      <div className="cards">{children}</div>
    </section>
  )
}

function SortableCard(props: { task: Doc; project?: Doc; act: Actions; chained: boolean; agent?: Agent }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.name })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes} {...listeners} onClick={() => props.act.open(props.task)}>
      <Card {...props} />
    </div>
  )
}

// Memoised: while you drag, the board re-renders on every move, but a card only when its task or its agent changes.
// A card with an agent at work or waiting on it says so; one whose last agent is done shows a faint bot.
// Either opens the session.
const Card = memo(function Card({ task, project, act, chained, agent, inHand }: {
  task: Doc; project?: Doc; act?: Actions; chained?: boolean; agent?: Agent; inHand?: 'lifted' | 'held'
}) {
  const d = task.data
  const stop = (fn: () => void) => ({ onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: (e: React.MouseEvent) => { e.stopPropagation(); fn() } })
  return (
    <article className={`card ${isFocus(task) ? 'focus' : ''} ${inHand ? `in-hand ${inHand}` : ''}`}>
      <div className="card-top">
        <button className="link-plain project" title="Open project overview" {...stop(() => act?.project(unlink(d.project)))}>
          <span className={`dot ${project?.data.context ?? ''}`} />{project?.data.name ?? (unlink(d.project) || 'No project')}
        </button>
        <span className="spacer" />
        <span className={`prio ${d.priority}`}>{prioLabel(d.priority)}</span>
        {/* A pinned card shows its pin; pinning one is a hover action, so the project name keeps the room. */}
        {act && isFocus(task) && <span className="pin on"><IconButton icon={Pin} label="Unpin" active stop onClick={() => act.focus(task)} /></span>}
      </div>
      <div className="title">{d.title ?? task.name}</div>
      {task.error && <div className="blocked">Invalid frontmatter, fix in Obsidian</div>}
      {d.blocked_by && <div className="blocked"><Ban size={12} strokeWidth={1.8} aria-label="Blocked by" /> {blockersOf(task).join(', ') || unlink(d.blocked_by)}</div>}
      <div className="card-bottom">
        <span className="id">{task.name}</span>
        {act && chained && <IconButton icon={Workflow} label="Dependencies: see this ticket's chain" stop onClick={() => act.deps(task)} />}
        {d.due && <span className="due">due {d.due}</span>}
        {agent && (isActive(agent)
          ? <button className={`card-agent state ${agent.state}`} title="Open this agent's session" {...stop(() => act?.agent(agent))}>
            <Bot size={12} strokeWidth={1.8} aria-hidden />{STATE_LABEL[agent.state]}</button>
          : <button className="card-agent last" title={`Last agent: ${STATE_LABEL[agent.state] ?? agent.state}, ${ago(agent.updated)}. Open its session`} aria-label="Open the last agent's session" {...stop(() => act?.agent(agent))}>
            <Bot size={14} strokeWidth={1.8} aria-hidden /></button>)}
        <div className="spacer" />
        {d.pr && <IconLink icon={GitPullRequest} label="Pull request" href={d.pr} />}
        {act && <span className="hover-actions">{!isFocus(task) && <IconButton icon={Pin} label="Pin to the top" stop onClick={() => act.focus(task)} />}<IconButton icon={Play} label="Start an agent on this task" stop onClick={() => act.start(task)} /><IconButton icon={Rocket} label="Autopilot: an agent solves it on its own" stop onClick={() => act.autopilot(task)} /></span>}
      </div>
    </article>
  )
})
