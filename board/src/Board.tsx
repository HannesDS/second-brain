import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GitPullRequest, Play, Star } from 'lucide-react'
import type { Actions } from './Today'
import { IconButton, IconLink } from './ui'
import { LABELS, STATUSES, api, byOrder, columnOf, isFocus, prioLabel, unlink, type Doc, type Vault } from './lib'

// The board: drag between columns to change status, within a column to reorder. Used full-size on the
// Board page and trimmed on My day (fewer columns, `limit` cards each), so both show the same thing.
export default function BoardColumns({ tasks, vault, setVault, fail, act, statuses = STATUSES, limit, more }: {
  tasks: Doc[]; vault: Vault; setVault: (v: Vault) => void; fail: (e: Error) => void; act: Actions
  statuses?: string[]; limit?: number; more?: () => void
}) {
  const projects = useMemo(() => Object.fromEntries(vault.projects.map((p) => [p.name, p])), [vault.projects])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [active, setActive] = useState<Doc>()
  const columns = useMemo(() => {
    const cols: Record<string, Doc[]> = Object.fromEntries(statuses.map((s) => [s, []]))
    for (const t of tasks) cols[columnOf(t)]?.push(t)
    // Starred tasks sit at the top of their column.
    for (const c of Object.values(cols)) c.sort((a, b) => Number(isFocus(b)) - Number(isFocus(a)) || byOrder(a, b))
    return cols
  }, [tasks, statuses])

  function onDragEnd({ active: a, over }: DragEndEvent) {
    setActive(undefined)
    if (!over) return
    const task = tasks.find((t) => t.name === a.id)!
    const from = columnOf(task)
    const overId = String(over.id)
    const to = overId.startsWith('col:') ? overId.slice(4) : columnOf(tasks.find((t) => t.name === overId)!)
    if (!columns[to]) return
    // Reorder the whole column, not only the cards shown, so hidden cards keep their place.
    let target: Doc[]
    if (from === to) {
      const col = columns[to]
      const newIndex = overId.startsWith('col:') ? col.length - 1 : col.findIndex((t) => t.name === overId)
      target = arrayMove(col, col.indexOf(task), newIndex)
    } else {
      target = [...columns[to]]
      const i = target.findIndex((t) => t.name === overId)
      target.splice(i < 0 ? target.length : i, 0, task)
    }
    const moves = target
      .map((t, order) => ({ id: t.name, status: to, order }))
      .filter((m, i) => target[i].data.status !== m.status || Number(target[i].data.order) !== m.order)
    if (!moves.length) return
    const patch = Object.fromEntries(moves.map((m) => [m.id, m]))
    setVault({ ...vault, tasks: vault.tasks.map((t) => patch[t.name] ? { ...t, data: { ...t.data, ...patch[t.name] } } : t) })
    api('move', 'POST', moves).catch(fail)
  }

  const cols = statuses === STATUSES && tasks.some((t) => columnOf(t) === '?') ? [...statuses, '?'] : statuses
  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}
      onDragStart={(e) => setActive(tasks.find((t) => t.name === e.active.id))} onDragCancel={() => setActive(undefined)}>
      <div className="board" style={{ gridTemplateColumns: limit ? `repeat(${cols.length}, minmax(0, 1fr))` : undefined }}>
        {cols.map((s) => {
          const all = columns[s] ?? tasks.filter((t) => columnOf(t) === '?')
          const shown = limit ? all.slice(0, limit) : all
          return (
            <Column key={s} status={s} count={all.length}>
              <SortableContext items={shown.map((t) => t.name)} strategy={verticalListSortingStrategy}>
                {shown.map((t) => <SortableCard key={t.name} task={t} project={projects[unlink(t.data.project)]} act={act} />)}
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

function SortableCard(props: { task: Doc; project?: Doc; act: Actions }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.name })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes} {...listeners} onClick={() => props.act.open(props.task)}>
      <Card {...props} />
    </div>
  )
}

function Card({ task, project, act }: { task: Doc; project?: Doc; act?: Actions }) {
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
        {d.due && <span className="due">due {d.due}</span>}
        <div className="spacer" />
        {d.pr && <IconLink icon={GitPullRequest} label="Pull request" href={d.pr} />}
        {act && <span className="hover-actions"><IconButton icon={Play} label="Start an agent on this task" stop onClick={() => act.start(task)} /></span>}
      </div>
    </article>
  )
}
