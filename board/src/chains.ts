// How tickets connect: `blocked_by` makes edges (blocker -> dependent), a `Parent: [[T-NNNN]]` body line
// puts a ticket in its feature's lane. Pure, so the dependency view only draws what this works out.
import { blockersOf } from '../queue'

type Task = { name: string; data: Record<string, any>; body?: string }

export const parentOf = (t: Task) => t.body?.match(/^Parent:\s*\[\[(T-\d{4})/m)?.[1]

// Blocker -> dependent pairs between the given tasks; blockers outside them are left out.
export function edgesOf(tasks: Task[]) {
  const names = new Set(tasks.map((t) => t.name))
  return tasks.flatMap((t) => blockersOf(t).filter((b) => names.has(b) && b !== t.name).map((b) => ({ from: b, to: t.name })))
}

// Tasks with at least one blocker or dependent among `tasks`: the ones that belong in a chain.
export function linked(tasks: Task[]) {
  return new Set(edgesOf(tasks).flatMap((e) => [e.from, e.to]))
}

// A ticket's chain: everything it waits on, transitively, and everything that waits on it.
export function chainOf<T extends Task>(tasks: T[], name: string) {
  const edges = edgesOf(tasks)
  const out = new Set([name])
  const walk = (start: string, next: (n: string) => string[]) => {
    const todo = [start]
    while (todo.length) for (const n of next(todo.pop()!)) if (!out.has(n)) { out.add(n); todo.push(n) }
  }
  walk(name, (n) => edges.filter((e) => e.to === n).map((e) => e.from))
  walk(name, (n) => edges.filter((e) => e.from === n).map((e) => e.to))
  return tasks.filter((t) => out.has(t.name))
}

// Column per task: one right of its furthest blocker, so work lands after what it builds on.
// An edge that closes a cycle is ignored rather than looping.
export function layers(tasks: Task[]) {
  const edges = edgesOf(tasks)
  const layer = new Map<string, number>()
  const visiting = new Set<string>()
  const of = (n: string): number => {
    if (layer.has(n)) return layer.get(n)!
    if (visiting.has(n)) return -1
    visiting.add(n)
    const l = Math.max(-1, ...edges.filter((e) => e.to === n).map((e) => of(e.from))) + 1
    visiting.delete(n)
    layer.set(n, l)
    return l
  }
  for (const t of tasks) of(t.name)
  return layer
}

// The feature a task is drawn with: its parent, or itself when it is a parent; '' for loose tickets.
export function laneOf(t: Task, tasks: Task[]) {
  return parentOf(t) ?? (tasks.some((x) => parentOf(x) === t.name) ? t.name : '')
}

export const NODE_W = 220
export const NODE_H = 72
const GAP_X = 80
const GAP_Y = 16
const LANE_PAD = 28

// Left-to-right layout: x by layer, lanes stacked top to bottom (loose tickets last), and inside a lane
// each column's tickets stacked by id. Returns top-left positions and each lane's box for its backdrop.
export function layout(tasks: Task[]) {
  const layer = layers(tasks)
  const lanes = new Map<string, Task[]>()
  for (const t of [...tasks].sort((a, b) => a.name.localeCompare(b.name))) {
    const lane = laneOf(t, tasks)
    lanes.set(lane, [...(lanes.get(lane) ?? []), t])
  }
  const order = [...lanes.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b))
  const pos = new Map<string, { x: number; y: number }>()
  const boxes: { lane: string; y: number; height: number }[] = []
  let y = 0
  for (const lane of order) {
    const rows = new Map<number, number>()
    for (const t of lanes.get(lane)!) {
      const l = layer.get(t.name)!
      const row = rows.get(l) ?? 0
      rows.set(l, row + 1)
      pos.set(t.name, { x: l * (NODE_W + GAP_X), y: y + LANE_PAD + row * (NODE_H + GAP_Y) })
    }
    const height = LANE_PAD + Math.max(...rows.values()) * (NODE_H + GAP_Y)
    boxes.push({ lane, y, height })
    y += height + GAP_Y
  }
  return { pos, lanes: boxes, width: (Math.max(0, ...layer.values()) + 1) * (NODE_W + GAP_X) - GAP_X }
}
