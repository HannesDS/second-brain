import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, getFirstCollision, pointerWithin, rectIntersection, useDroppable, useSensor,
  useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS, getEventCoordinates } from '@dnd-kit/utilities'
import { GitPullRequest, Play, Rocket, Star, Workflow } from 'lucide-react'
import type { Actions } from './Today'
import { aim, dragOver, dragScroll, dropMoves, rebase, type Layout, type Sticky } from './drag'
import { IconButton, IconLink } from './ui'
import { linked } from './chains'
import { LABELS, STATUSES, api, byFinished, byOrder, columnOf, isFocus, prioLabel, starred, todayISO, unlink, type Doc, type Vault } from './lib'

// The board: drag between columns to change status, within a column to reorder. Used full-size on the
// Board page and trimmed on My day (fewer columns, `limit` cards each), so both show the same thing.
export default function BoardColumns({ tasks, vault, drop, fail, act, statuses = STATUSES, limit, more }: {
  tasks: Doc[]; vault: Vault; drop: (v: Vault, write: Promise<unknown>) => Promise<void>; fail: (e: Error) => void; act: Actions
  statuses?: string[]; limit?: number; more?: () => void
}) {
  const projects = useMemo(() => Object.fromEntries(vault.projects.map((p) => [p.name, p])), [vault.projects])
  const byName = useMemo(() => Object.fromEntries(tasks.map((t) => [t.name, t])), [tasks])
  // Where a card goes in a column that isn't Done, which ignores stars. Made anew only when the vault
  // changes, so the groups cached while aiming last the whole drag.
  const stars = useMemo(() => new Set(vault.tasks.filter((t) => starred(t.data)).map((t) => t.name)), [vault.tasks])
  const isStarred = useCallback((id: string) => stars.has(id), [stars])
  const chained = useMemo(() => linked(vault.tasks), [vault.tasks])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [active, setActive] = useState<Doc>()
  const hasUnknown = statuses === STATUSES && tasks.some((t) => columnOf(t) === '?')
  const cols = useMemo(() => (hasUnknown ? [...statuses, '?'] : statuses), [statuses, hasUnknown])
  const layout = useMemo(() => {
    const docs: Record<string, Doc[]> = Object.fromEntries(cols.map((s) => [s, []]))
    for (const t of tasks) docs[columnOf(t)]?.push(t)
    // Starred tasks sit at the top of their column; Done shows the latest finished first.
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

  // When the board may scroll (see dragScroll), from the pointer carrying the card.
  const scroll = useRef<ReturnType<typeof dragScroll>>(undefined)
  // Only the pointer carrying the card: on touch, another finger (or the mouse) can move too.
  const carrying = useRef<number>(undefined)
  const follow = useCallback((e: PointerEvent) => { if (e.pointerId === carrying.current) scroll.current?.move({ x: e.clientX, y: e.clientY }) }, [])
  const stopFollowing = () => { removeEventListener('pointermove', follow); scroll.current = undefined }
  useEffect(() => () => removeEventListener('pointermove', follow), [follow])
  const autoScroll = useMemo(() => ({ canScroll: () => scroll.current?.may() ?? false }), [])

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
    stopFollowing()
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
    <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd} onDragOver={onDragOver} autoScroll={autoScroll}
      onDragStart={(e) => { const start = getEventCoordinates(e.activatorEvent); if (start) { scroll.current = dragScroll(start); carrying.current = (e.activatorEvent as PointerEvent).pointerId; addEventListener('pointermove', follow) } setActive(byName[e.active.id]); setPreview(layout); sticky.current = { justMoved: false, active: String(e.active.id), home: columnOf(byName[e.active.id]) } }}
      onDragCancel={() => { stopFollowing(); setActive(undefined); setPreview(undefined) }}>
      <div className="board" style={{ gridTemplateColumns: limit ? `repeat(${cols.length}, minmax(0, 1fr))` : undefined }}>
        {cols.map((s) => {
          // A task can vanish mid-drag when the vault reloads; the preview may still name it.
          const all = shownLayout[s].map((id) => byName[id]).filter(Boolean)
          const shown = limit ? all.slice(0, limit) : all
          return (
            <Column key={s} status={s} count={all.length}>
              <SortableContext items={shown.map((t) => t.name)} strategy={verticalListSortingStrategy}>
                {shown.map((t) => <SortableCard key={t.name} task={t} project={projects[unlink(t.data.project)]} act={act} chained={chained.has(t.name)} />)}
              </SortableContext>
              {all.length > shown.length && <button className="more" onClick={more}>+{all.length - shown.length} more on the Board</button>}
            </Column>
          )
        })}
      </div>
      {/* The card in hand looks exactly like the hovered card you picked up, so nothing shifts under the pointer.
          It lives on <body>: dnd-kit places it in window coordinates, which a transformed view would offset. */}
      {createPortal(<DragOverlay>{active && <Card task={active} project={projects[unlink(active.data.project)]} act={act} chained={chained.has(active.name)} lifted />}</DragOverlay>, document.body)}
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

function SortableCard(props: { task: Doc; project?: Doc; act: Actions; chained: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.name })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes} {...listeners} onClick={() => props.act.open(props.task)}>
      <Card {...props} />
    </div>
  )
}

// Memoised: while you drag, the board re-renders on every move, but a card only when its task changes.
const Card = memo(function Card({ task, project, act, chained, lifted }: { task: Doc; project?: Doc; act?: Actions; chained?: boolean; lifted?: boolean }) {
  const d = task.data
  const stop = (fn: () => void) => ({ onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: (e: React.MouseEvent) => { e.stopPropagation(); fn() } })
  return (
    <article className={`card ${isFocus(task) ? 'focus' : ''} ${lifted ? 'lifted' : ''}`}>
      <div className="card-top">
        <button className="link-plain project" title="Open project overview" {...stop(() => act?.project(unlink(d.project)))}>
          <span className={`dot ${project?.data.context ?? ''}`} />{project?.data.name ?? (unlink(d.project) || 'No project')}
        </button>
        <span className="spacer" />
        <span className={`prio ${d.priority}`}>{prioLabel(d.priority)}</span>
        {act && <span className={`star ${isFocus(task) ? 'on' : ''}`}><IconButton icon={Star} label={isFocus(task) ? 'Unstar' : 'Star: keep at the top'} active={isFocus(task)} stop onClick={() => act.focus(task)} /></span>}
      </div>
      <div className="title">{d.title ?? task.name}</div>
      {task.error && <div className="blocked">Invalid frontmatter, fix in Obsidian</div>}
      {d.blocked_by && <div className="blocked">⛔ {unlink(d.blocked_by)}</div>}
      <div className="card-bottom">
        <span className="id">{task.name}</span>
        {act && chained && <IconButton icon={Workflow} label="Dependencies: see this ticket's chain" stop onClick={() => act.deps(task)} />}
        {d.due && <span className="due">due {d.due}</span>}
        <div className="spacer" />
        {d.pr && <IconLink icon={GitPullRequest} label="Pull request" href={d.pr} />}
        {act && <span className="hover-actions"><IconButton icon={Play} label="Start an agent on this task" stop onClick={() => act.start(task)} /><IconButton icon={Rocket} label="Autopilot: an agent solves it on its own" stop onClick={() => act.autopilot(task)} /></span>}
      </div>
    </article>
  )
})
