import { useEffect, useRef, useState } from 'react'
import FrappeGantt from 'frappe-gantt'
import 'frappe-gantt.css'
import { api, unlink, type Doc } from './lib'

const MODES = ['Day', 'Week', 'Month']

// Timeline of tasks that have a start or due date, grouped by project. Drag bars to replan.
export default function Gantt({ tasks, projects, open, fail }: {
  tasks: Doc[]; projects: Record<string, Doc>; open: (d: Doc) => void; fail: (e: Error) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState('Week')
  const dated = tasks
    .filter((t) => t.data.status !== 'done' && (t.data.start || t.data.due))
    .sort((a, b) => unlink(a.data.project).localeCompare(unlink(b.data.project)) || String(a.data.start || a.data.due).localeCompare(String(b.data.start || b.data.due)))

  useEffect(() => {
    if (!host.current || !dated.length) return
    host.current.innerHTML = ''
    const rows = dated.map((t) => {
      const end = String(t.data.due || t.data.start)
      const start = String(t.data.start || t.data.created || end)
      return {
        id: t.name,
        name: `${projects[unlink(t.data.project)]?.data.name ?? unlink(t.data.project)} · ${t.data.title}`,
        start: start <= end ? start : end,
        end,
        progress: t.data.status === 'review' ? 80 : t.data.status === 'wip' ? 40 : 0,
        custom_class: `bar-${t.data.priority ?? 'p2'}`,
      }
    })
    new FrappeGantt(host.current, rows, {
      view_mode: mode,
      readonly_progress: true,
      today_button: true,
      on_click: (row: { id: string }) => { const t = tasks.find((x) => x.name === row.id); if (t) open(t) },
      on_date_change: (row: { id: string }, start: Date, end: Date) =>
        api(`tasks/${row.id}`, 'PUT', { data: { start: start.toLocaleDateString('sv'), due: end.toLocaleDateString('sv') } }).catch(fail),
    })
  }, [JSON.stringify(dated.map((t) => [t.name, t.data.start, t.data.due, t.data.status, t.data.title])), mode])

  return (
    <main className="gantt-page">
      <div className="cal-head">
        <h2>Timeline</h2>
        <div className="spacer" />
        {MODES.map((m) => <button key={m} className={m === mode ? 'tab on' : 'tab'} onClick={() => setMode(m)}>{m}</button>)}
      </div>
      {dated.length
        ? <div ref={host} className="gantt-host" />
        : <p className="muted">No tasks with a start or due date yet. Set them in a task, or they come from the Notion Roadmap's Time field.</p>}
    </main>
  )
}
