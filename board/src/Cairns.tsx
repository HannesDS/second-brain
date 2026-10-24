import { Activity, Check, CircleDot, Droplet, Moon, Pencil, Plus, Trash2, Wind, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { stringify } from 'yaml'
import { Fold, IconButton, NumberInput, useEscape } from './ui'
import {
  CAIRN_KINDS, WEEKDAYS, cairnData, goalOf, isDone, scheduleOf, slugOf, weekDots,
  type Cairn, type CairnKind,
} from './day'
import type { Doc } from './lib'

// An icon from the name, so a cairn needs no icon field.
const ICONS: [RegExp, LucideIcon][] = [[/breath/i, Wind], [/water|drink/i, Droplet], [/stretch|walk|move/i, Activity], [/shut|sleep|night/i, Moon]]
const iconOf = (c: Cairn) => ICONS.find(([re]) => re.test(c.name))?.[1] ?? CircleDot
const isBreathe = (c: Cairn) => c.kind === 'timer' && /breath/i.test(c.name)

// Box breathing: in 4, hold 4, out 4, hold 4.
const PHASES = ['Breathe in', 'Hold', 'Breathe out', 'Hold']
export type Running = { slug: string; ends: number }

// One card per cairn due today: what it is, when, how far you are, this week, and the one action it needs.
export function Cairns({ cairns, log, days, meetings, now, running, tick, add, start, stop, edit, remove }: {
  cairns: Cairn[]; log: Record<string, unknown>; days: Doc[]; meetings: number; now: Date; running?: Running
  tick: (c: Cairn, value: string | number | null) => void; add: (c: Cairn, by?: number) => void
  start: (c: Cairn) => void; stop: () => void; edit: (c?: Cairn) => void; remove: (c: Cairn) => void
}) {
  const done = cairns.filter((c) => isDone(c, log[c.slug], goalOf(c, meetings))).length
  return (
    <Fold id="cairns" className="cairns-section" title="Cairns"
      extra={<>{cairns.length > 0 && <span className="count">{done} of {cairns.length}</span>}<span className="muted hint-inline">Small things that keep you on the trail.</span></>}
      actions={cairns.length > 0 && <IconButton icon={Plus} label="Add a cairn" showLabel onClick={() => edit()} />}>
      {!cairns.length && (
        <div className="cairns-empty">
          <span className="muted">No cairns today. Add one: breathe, drink water, stretch, shut down.</span>
          <IconButton icon={Plus} label="Add a cairn" showLabel onClick={() => edit()} />
        </div>
      )}
      <div className="cairn-grid">
        {cairns.map((c) => {
          const value = log[c.slug]
          const n = value === 'done' ? goalOf(c, meetings) : Number(value) || 0
          const goal = goalOf(c, meetings)
          const ok = isDone(c, value, goal)
          const Icon = iconOf(c)
          const timer = running?.slug === c.slug ? running : undefined
          const detail = c.kind === 'timer' ? `${c.minutes} min${isBreathe(c) ? ', box breathing: in 4, hold 4, out 4, hold 4.' : '.'}`
            : c.after === 'meeting' ? (meetings ? `${n} of ${meetings} meetings. Pops up as a meeting ends.` : 'No meetings today.')
            : c.kind === 'count' ? `${n} of ${c.target}.` : c.after === 'first-meeting' ? 'Once your first meeting ends.' : 'Tick it when it is done.'
          // Done undoes: a count steps back one, the rest clears.
          const action = ok ? { label: 'Done', run: () => (c.kind === 'count' || c.after === 'meeting') && value !== 'done' ? add(c, -1) : tick(c, null) }
            : c.kind === 'timer' ? { label: 'Start', run: () => start(c) }
            : c.kind === 'count' || c.after === 'meeting' ? { label: '+1', run: () => add(c) }
            : { label: 'Mark done', run: () => tick(c, 'done') }
          return (
            <article key={c.slug} className={`cairn ${ok ? 'done' : ''}`}>
              <div className="cairn-head">
                <span className="cairn-icon"><Icon size={18} strokeWidth={1.8} aria-hidden /></span>
                <span className="cairn-name"><span className="cairn-title">{c.name}</span><span className="time">{scheduleOf(c)}</span></span>
                <span className="hover-actions">
                  <IconButton icon={Pencil} label={`Edit ${c.name}`} onClick={() => edit(c)} />
                  <IconButton icon={Trash2} label={`Delete ${c.name}`} onClick={() => remove(c)} />
                </span>
              </div>
              {timer ? <Timer cairn={c} running={timer} now={now} stop={stop} /> : <p className="cairn-detail">{detail}</p>}
              {goal > 1 && !timer && (
                <div className="pips" role="img" aria-label={`${Math.min(n, goal)} of ${goal}`}>
                  {Array.from({ length: goal }, (_, i) => <span key={i} className={`pip ${i < n ? 'on' : ''}`} />)}
                </div>
              )}
              <div className="cairn-foot">
                <div className="week" role="list" aria-label="This week">
                  {weekDots(c, now, days, meetings).map((d) => <span key={d.date} role="listitem" className={`week-dot wd-${d.state}`} title={d.label} aria-label={d.label} />)}
                </div>
                {!timer && <button type="button" className={ok ? 'cairn-done' : 'primary'} onClick={action.run} title={ok ? 'Undo' : undefined}>
                  {ok && <Check size={14} strokeWidth={1.8} aria-hidden />}{action.label}
                </button>}
              </div>
            </article>
          )
        })}
      </div>
    </Fold>
  )
}

// A running timer inline on its card. Breathe draws the contour rings as a guide; with reduced motion they hold still
// and only the words change.
function Timer({ cairn, running, now, stop }: { cairn: Cairn; running: Running; now: Date; stop: () => void }) {
  const left = Math.max(0, Math.ceil((running.ends - now.getTime()) / 1000))
  const elapsed = cairn.minutes * 60 - left
  return (
    <div className="cairn-timer">
      {isBreathe(cairn) && (
        <div className="breathe" aria-hidden>
          <span className="breathe-ring r3" /><span className="breathe-ring r2" /><span className="breathe-ring r1" />
        </div>
      )}
      <div className="timer-text">
        {isBreathe(cairn) && <span className="breathe-phase" aria-live="polite">{PHASES[Math.floor(elapsed / 4) % 4]}</span>}
        <span className="time">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</span>
        <button type="button" onClick={stop}>Stop</button>
      </div>
    </div>
  )
}

type Draft = Omit<Cairn, 'slug'>
const BLANK: Draft = { name: '', kind: 'check', target: 8, minutes: 3, days: 'daily', at: '', after: '', context: 'all', nudge: false }
const KIND_HINT: Record<CairnKind, string> = { check: 'Done or not', count: 'A number a day', timer: 'Minutes' }
const CONTEXT_LABEL = { all: 'All', dm: 'Data Minded', personal: 'Personal' } as const

// Add or edit a cairn, with the frontmatter it will be saved as.
export function CairnForm({ cairn, taken, save, close }: { cairn?: Cairn; taken: string[]; save: (slug: string, data: Record<string, unknown>, isNew: boolean) => void; close: () => void }) {
  const [d, setD] = useState<Draft>(cairn ?? BLANK)
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch })
  useEscape(close)
  const when = d.after ? 'trail' : d.days === 'daily' ? 'daily' : 'days'
  const slug = cairn?.slug ?? slugOf(d.name)
  const clash = !cairn && taken.includes(slug)
  const data = cairnData(d)
  const days = d.days === 'daily' ? [] : d.days
  return (
    <>
      <div className="scrim" onClick={close} />
      <form className="popover cairn-form" role="dialog" aria-label={cairn ? 'Edit cairn' : 'Add a cairn'}
        onSubmit={(e) => { e.preventDefault(); if (d.name.trim() && !clash) save(slug, data, !cairn) }}>
        <div className="choose-head">
          <div>
            <span className="time eyebrow">{cairn ? 'Cairn' : 'New cairn'}</span>
            <h2>{cairn ? `Edit ${cairn.name}` : 'Add a cairn'}</h2>
            <p className="muted">A small thing that comes back on your trail.</p>
          </div>
          <IconButton icon={X} label="Close" onClick={close} />
        </div>
        <label className="choose-group">
          <span className="eyebrow">Name</span>
          <input autoFocus required value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Breathe" />
          {clash && <span className="muted">There already is a cairn called {slug}.</span>}
        </label>
        <div className="choose-group">
          <span className="eyebrow">How you tick it</span>
          <div className="kind-grid" role="radiogroup" aria-label="How you tick it">
            {CAIRN_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={d.kind === k} className={`kind-option ${d.kind === k ? 'on' : ''}`} onClick={() => set({ kind: k })}>
                <span className="way-title">{k[0].toUpperCase() + k.slice(1)}</span><span className="muted">{KIND_HINT[k]}</span>
              </button>
            ))}
          </div>
          {d.kind === 'count' && <label className="inline-field">Target <NumberInput value={d.target} max={24} onChange={(target) => set({ target })} /></label>}
          {d.kind === 'timer' && <label className="inline-field">Minutes <NumberInput value={d.minutes} max={120} onChange={(minutes) => set({ minutes })} /></label>}
        </div>
        <fieldset className="choose-group when">
          <legend className="eyebrow">When it shows up</legend>
          <label className={`when-option ${when === 'daily' ? 'on' : ''}`}><input type="radio" name="when" checked={when === 'daily'} onChange={() => set({ days: 'daily', after: '' })} />Every day</label>
          <label className={`when-option ${when === 'days' ? 'on' : ''}`}>
            <input type="radio" name="when" checked={when === 'days'} onChange={() => set({ days: ['mon', 'tue', 'wed', 'thu', 'fri'], after: '' })} />On these days
            <span className="day-picks">
              {WEEKDAYS.map((w) => {
                const on = days.includes(w)
                return <button key={w} type="button" className={`day-pick ${on ? 'on' : ''}`} aria-pressed={on} aria-label={w}
                  onClick={() => { const next = on ? days.filter((x) => x !== w) : WEEKDAYS.filter((x) => x === w || days.includes(x)); set({ days: next.length ? next : 'daily', after: '' }) }}>{w[0].toUpperCase()}</button>
              })}
            </span>
          </label>
          <label className={`when-option ${when === 'trail' ? 'on' : ''}`}>
            <input type="radio" name="when" checked={when === 'trail'} onChange={() => set({ after: 'meeting', at: '' })} />Tied to the trail
            <select value={d.after || 'meeting'} onChange={(e) => set({ after: e.target.value as Draft['after'], at: '' })} aria-label="Which meeting">
              <option value="meeting">after each meeting</option><option value="first-meeting">after the first meeting</option>
            </select>
          </label>
        </fieldset>
        <div className="form-pair">
          {!d.after && <label className="choose-group"><span className="eyebrow">At</span><input type="time" value={d.at} onChange={(e) => set({ at: e.target.value })} /></label>}
          <div className="choose-group">
            <span className="eyebrow">Context</span>
            <div className="segmented" role="radiogroup" aria-label="Context">
              {(Object.keys(CONTEXT_LABEL) as Draft['context'][]).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={d.context === c} className={d.context === c ? 'on' : ''} onClick={() => set({ context: c })}>{CONTEXT_LABEL[c]}</button>
              ))}
            </div>
          </div>
        </div>
        <label className="check-line"><input type="checkbox" checked={d.nudge} onChange={(e) => set({ nudge: e.target.checked })} />Nudge me when it is time</label>
        <div className="choose-group">
          <span className="eyebrow">Saved in your vault as cairns/{slug}.md</span>
          <pre className="frontmatter">{`---\n${stringify(data, { lineWidth: 0 })}---`}</pre>
        </div>
        <div className="row-actions">
          <button type="button" onClick={close}>Cancel</button>
          <button type="submit" className="primary" disabled={!d.name.trim() || clash}>{cairn ? 'Save cairn' : 'Add cairn'}</button>
        </div>
      </form>
    </>
  )
}
