import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, getFirstCollision, pointerWithin, rectIntersection, useDroppable, useSensor,
  useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GitPullRequest, Play, Rocket, Star, Workflow } from 'lucide-react'
import type { Actions } from './Today'
import { dragOver, dropMoves, type Layout } from './drag'
import { IconButton, IconLink } from './ui'
import { linked } from './chains'
import { LABELS, STATUSES, api, byFinished, byOrder, columnOf, isFocus, prioLabel, todayISO, unlink, type Doc, type Vault } from './lib'

// The board: drag between columns to change status, within a column to reorder. Used full-size on the
// Board page and trimmed on My day (fewer columns, `limit` cards each), so both show the same thing.
export default function BoardColumns({ tasks, vault, setVault, fail, act, statuses = STATUSES, limit, more }: {
  tasks: Doc[]; vault: Vault; setVault: (v: Vault) => void; fail: (e: Error) => void; act: Actions
  statuses?: string[]; limit?: number; more?: () => void
}) {
  const projects = useMemo(() => Object.fromEntries(vault.projects.map((p) => [p.name, p])), [vault.projects])
  const byName = useMemo(() => Object.fromEntries(tasks.map((t) => [t.name, t])), [tasks])
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
  const [preview, setPreview] = useState<Layout>()
  const shownLayout = preview ?? layout

  // Over a column, aim at its nearest card. Right after the card changed column, stay on the last target
  // until the layout has caught up, or the card flips between two columns at their edge (dnd-kit's
  // multiple-containers recipe).
  const lastOver = useRef<UniqueIdentifier>(undefined)
  const justMoved = useRef(false)
  useEffect(() => { requestAnimationFrame(() => { justMoved.current = false }) }, [preview])
  const collision = useCallback<CollisionDetection>((args) => {
    const hits = pointerWithin(args)
    let overId = getFirstCollision(hits.length ? hits : rectIntersection(args), 'id')
    if (overId != null) {
      const cards = String(overId).startsWith('col:') ? shownLayout[String(overId).slice(4)] : undefined
      if (cards?.length) overId = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => cards.includes(String(c.id))) })[0]?.id ?? overId
      lastOver.current = overId
      return [{ id: overId }]
    }
    if (justMoved.current) lastOver.current = args.active.id
    return lastOver.current != null ? [{ id: lastOver.current }] : []
  }, [shownLayout])

  function onDragOver({ active: a, over }: DragOverEvent) {
    if (!over) return
    // After the card it's over once the dragged card's middle is past that card's middle.
    const r = a.rect.current.translated
    const below = !!r && r.top + r.height / 2 > over.rect.top + over.rect.height / 2
    const next = dragOver(shownLayout, String(a.id), String(over.id), limit, below)
    if (next === shownLayout) return
    justMoved.current = true
    setPreview(next)
  }

  function onDragEnd({ active: a, over }: DragEndEvent) {
    const moves = over ? dropMoves(layout, shownLayout, String(a.id), String(over.id), (id) => byName[id]?.data ?? {}, limit) : []
    setActive(undefined)
    setPreview(undefined)
    if (!moves.length) return
    const from = byName[a.id]?.data.status
    const patch = Object.fromEntries(moves.map((m) => [m.id, m.status === 'done' && from !== 'done' ? { ...m, completed: todayISO() } : m]))
    setVault({ ...vault, tasks: vault.tasks.map((t) => patch[t.name] ? { ...t, data: { ...t.data, ...patch[t.name] } } : t) })
    api('move', 'POST', moves).catch(fail)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd} onDragOver={onDragOver}
      onDragStart={(e) => { setActive(byName[e.active.id]); setPreview(layout); lastOver.current = undefined }}
      onDragCancel={() => { setActive(undefined); setPreview(undefined) }}>
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
      <DragOverlay>{active && <Card task={active} project={projects[unlink(active.data.project)]} />}</DragOverlay>
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
const Card = memo(function Card({ task, project, act, chained }: { task: Doc; project?: Doc; act?: Actions; chained?: boolean }) {
  const d = task.data
  const stop = (fn: () => void) => ({ onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: (e: React.MouseEvent) => { e.stopPropagation(); fn() } })
  return (
    <article className={`card ${isFocus(task) ? 'focus' : ''}`}>
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
