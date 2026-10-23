// The highlighted option after an arrow key: wraps around both ends, -1 (nothing) when there are no options.
export function step(active: number, delta: 1 | -1, count: number): number {
  if (!count) return -1
  if (active < 0) return delta > 0 ? 0 : count - 1
  return (active + delta + count) % count
}

// The input the dropdown hangs from, in viewport pixels.
export type Anchor = { left: number; bottom: number; width: number }
export type Place = { left: number; top: number; width: number; maxHeight: number }

const WIDTH = 420 // at least; wider when the input is (the full-width sidebar on a phone)
const GAP = 4
const EDGE = 12
const TALLEST = 0.6 // of the viewport

// Where the dropdown goes under the input: fixed to the viewport, so the sidebar's scroll box can't clip
// it, and never wider or taller than what's left of the screen.
export function place(input: Anchor, viewport: { width: number; height: number }): Place {
  const want = Math.max(WIDTH, input.width)
  const left = Math.max(Math.min(EDGE, input.left), Math.min(input.left, viewport.width - want - EDGE))
  const top = input.bottom + GAP
  return {
    left,
    top,
    width: Math.min(want, viewport.width - left - EDGE),
    maxHeight: Math.max(0, Math.min(viewport.height * TALLEST, viewport.height - top - EDGE)),
  }
}
