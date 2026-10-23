// The "ready" column is a queue: a ready task whose blockers are all done starts on its own, most urgent
// first, at most `max` runs at a time.
type Task = { name: string; data: Record<string, any> }

// Starts what fits next to the `running` tasks. A task whose start throws is skipped and takes no slot.
export function startReady(tasks: Task[], running: Set<string>, max: number, start: (task: string) => void) {
  const status = new Map(tasks.map((t) => [t.name, t.data.status]))
  let free = max - running.size
  const queue = tasks.filter((t) => t.data.status === 'ready' && !running.has(t.name))
    .sort((a, b) => String(a.data.priority).localeCompare(String(b.data.priority)) || (Number(a.data.order) || 0) - (Number(b.data.order) || 0))
  for (const t of queue) {
    if (free <= 0) break
    const blockers = String(t.data.blocked_by ?? '').match(/T-\d{4}/g) ?? []
    if (blockers.some((b) => status.get(b) !== 'done')) continue
    try { start(t.name); free-- } catch (e: any) { console.error(`autopilot ${t.name}: ${e.message}`) }
  }
}
