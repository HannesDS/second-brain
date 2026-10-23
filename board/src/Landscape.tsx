import { columnOf, hillRings, unlink, type Doc } from './lib'

// Terrain's signature view: every project is a hill. More open tasks, more contour lines.
// Ring colours run from the peak outwards: blocked, in progress, review, to do.
// An ochre peak means there is urgent or high priority work. Click a hill to open the project.
export const BLOB = 'M0,-100 C58,-102 106,-58 100,2 C95,64 48,98 -4,100 C-62,102 -108,54 -100,-4 C-93,-60 -54,-98 0,-100Z'
const W = 1060
const H = 240
const MAX_HILLS = 7

type Hill = { id: string; name: string; open: number; rings: string[]; hot: boolean }

export default function Landscape({ projects, tasks, open }: { projects: Doc[]; tasks: Doc[]; open: (id: string) => void }) {
  const hills: Hill[] = projects
    .filter((p) => (p.data.status ?? 'active') === 'active')
    .map((p) => {
      const mine = tasks.filter((t) => unlink(t.data.project) === p.name && columnOf(t) !== 'done')
      return { id: p.name, name: p.data.name ?? p.name, open: mine.length, rings: hillRings(mine.map(columnOf)), hot: mine.some((t) => ['p0', 'p1'].includes(t.data.priority)) }
    })
    .filter((h) => h.open > 0)
    .sort((a, b) => b.open - a.open)
    .slice(0, MAX_HILLS)

  if (!hills.length) return null
  const max = hills[0].open
  // Hills sit in a row, biggest in the middle, so they never overlap.
  const row = hills.map((_, i) => i).sort((a, b) => Math.abs(a - (hills.length - 1) / 2) - Math.abs(b - (hills.length - 1) / 2))
  const order = [...hills.keys()].sort((a, b) => row.indexOf(a) - row.indexOf(b))
  const step = W / hills.length
  const fit = Math.min(1.5, (step * 0.46) / 100)
  return (
    <section className="landscape" aria-label="Work landscape">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={hills.map((h) => `${h.name}: ${h.open} open`).join(', ')}>
        <defs><path id="tr-blob" d={BLOB} /></defs>
        {hills.map((h, i) => {
          const slot = order.indexOf(i)
          const size = fit * (0.5 + 0.5 * Math.sqrt(h.open / max))
          const x = step * (slot + 0.5)
          const y = H / 2 + 26 + (slot % 2 ? 8 : -4)
          const rot = ((i * 37) % 24) - 12
          const go = () => open(h.id)
          // Outermost ring first so inner rings draw on top.
          const rings = [...h.rings].reverse()
          return (
            <g key={h.id} className="hill" transform={`translate(${x} ${y})`} role="button" tabIndex={0}
              aria-label={`${h.name}, ${h.open} open tasks`} onClick={go} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && go()}>
              <g className="hill-rings" transform={`rotate(${rot})`}>
                <use href="#tr-blob" className="ring base" transform={`scale(${size} ${size * 0.78})`} />
                {rings.map((s, k) => {
                  const f = 1 - (k + 1) / (rings.length + 1)
                  return <use key={k} href="#tr-blob" className={`ring ${s}`} transform={`scale(${size * f} ${size * 0.78 * f})`} />
                })}
                <use href="#tr-blob" className={`peak ${h.hot ? 'hot' : ''}`} transform={`scale(${size * 0.12} ${size * 0.1})`} />
              </g>
              <text className="hill-name" y={-size * 82 - 22} textAnchor="middle">{h.name}</text>
              <text className="hill-meta" y={-size * 82 - 6} textAnchor="middle">{h.open} open</text>
            </g>
          )
        })}
      </svg>
      <div className="landscape-key">
        <span><i className="k blocked" />Blocked</span><span><i className="k wip" />In progress</span>
        <span><i className="k review" />Review</span><span><i className="k todo" />To do</span><span><i className="k hot" />Urgent or high</span>
      </div>
    </section>
  )
}
