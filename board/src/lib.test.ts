import { expect, onTestFinished, test, vi } from 'vitest'
import { agentLabel, byProject, dayRange, debounce, hillRings, loader, prReport, tabsOf, teachPrompt, todayISO, type Agent, type Doc, type Vault } from './lib'

const task = (body: string): Doc => ({ name: 'T-0081', data: { pr: 'https://github.com/x/y/pull/7' }, body })

test('finds the teach report linked from the task', () => {
  expect(prReport(task('## Reports\n- [PR](../reports/2026-10-23-t-0081-pr.html) 2026-10-23\n'))).toBe('2026-10-23-t-0081-pr.html')
})

test('ignores other reports and other tasks', () => {
  expect(prReport(task('- [Queues](../reports/2026-10-23-queues.html)\n- [PR](../reports/2026-10-23-t-0082-pr.html)'))).toBeUndefined()
})

test('the prompt names the file prReport looks for', () => {
  const file = `${todayISO()}-t-0081-pr.html`
  expect(teachPrompt(task(''), '/vault')).toContain(`/vault/reports/${file}`)
  expect(prReport(task(`- [PR](../reports/${file})`))).toBe(file)
})

// A promise you settle by hand.
function later<T>() {
  let settle!: (v: T) => void
  let fail!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => { settle = res; fail = rej })
  return { promise, settle, fail }
}

test('a load that was on its way when a drop came is asked again once the drop is written', async () => {
  const set = vi.fn()
  const answers = [later<string>(), later<string>()]
  let asked = 0
  const vault = loader(() => answers[asked++].promise, set)
  const loading = vault.load()
  const write = later<void>()
  vault.dropped('dropped', write.promise)
  await vi.waitFor(() => expect(asked).toBe(1))
  answers[0].settle('before the drop')
  await new Promise((r) => setTimeout(r, 0))
  // The old answer is not shown, and the second load waits for the write.
  expect(set.mock.calls).toEqual([['dropped']])
  expect(asked).toBe(1)
  write.settle()
  await vi.waitFor(() => expect(asked).toBe(2))
  answers[1].settle('after the drop')
  await loading
  expect(set.mock.calls).toEqual([['dropped'], ['after the drop']])
})

test('a load waits for the drops sent before it', async () => {
  const fetch = vi.fn(async () => 'files')
  const vault = loader(fetch, () => {})
  const write = later<void>()
  vault.dropped('dropped', write.promise)
  const loading = vault.load()
  await Promise.resolve()
  expect(fetch).not.toHaveBeenCalled()
  write.settle()
  await loading
  expect(fetch).toHaveBeenCalledOnce()
})

test('a failed drop reloads what the files say', async () => {
  const set = vi.fn()
  const vault = loader(async () => 'files', set)
  const write = later<void>()
  const reload = vault.dropped('dropped', write.promise)
  write.fail(new Error('invalid frontmatter'))
  await reload
  expect(set.mock.calls).toEqual([['dropped'], ['files']])
})

test('hill rings share out open work by status, from the peak outwards, ready counting as to do', () => {
  expect(hillRings([])).toEqual([])
  expect(hillRings(['todo', 'wip', 'blocked'])).toEqual(['blocked', 'wip', 'todo'])
  expect(hillRings(['ready', 'ready'])).toEqual(['todo', 'todo'])
  const many = hillRings([...Array(20).fill('todo'), 'review'])
  expect(many).toHaveLength(7)
  expect(many[0]).toBe('review')
})

const agent = (id: string, updated: string, more: Partial<Agent> = {}): Agent => ({ id, cwd: '/x/other', account: 'dm', state: 'idle', updated, ...more })
const agentVault: Vault = {
  root: '', vault: '', meetings: [],
  projects: [{ name: 'workbench', data: { repos: ['/x/brain'] }, body: '' }, { name: 'portal', data: { repos: ['/x/portal'] }, body: '' }],
  tasks: [{ name: 'T-0001', data: { title: 'Fix it', project: '[[portal]]' }, body: '' }],
}

test('an agent reads as its task, else its first prompt', () => {
  expect(agentLabel(agent('a', '', { task: 'T-0001', title: 'Autopilot: solve…' }), agentVault.tasks)).toBe('T-0001 Fix it')
  expect(agentLabel(agent('a', '', { title: 'Look at the logs' }), agentVault.tasks)).toBe('Look at the logs')
  expect(agentLabel(agent('a', ''), agentVault.tasks)).toBe('other')
})

test('agents group by project, the most recently active project and agent first', () => {
  const groups = byProject([
    agent('old', '2026-10-20', { cwd: '/x/brain' }),
    agent('task', '2026-10-21', { cwd: '/x/brain/.claude/worktrees/t', task: 'T-0001' }),
    agent('new', '2026-10-22', { cwd: '/x/brain/sub' }),
    agent('loose', '2026-10-19'),
  ], agentVault)
  expect(groups.map((g) => [g.project?.name, g.agents.map((a) => a.id)])).toEqual([
    ['workbench', ['new', 'old']], ['portal', ['task']], [undefined, ['loose']],
  ])
})

test('a session finds the tab that resumed it, else its task tab, never a tab it shares', () => {
  const tabs = tabsOf([
    agent('a', '2026-10-20', { task: 'T-0001' }),
    agent('b', '2026-10-22', { task: 'T-0001' }),
    agent('c', '2026-10-21'),
  ], [
    { id: 't1', task: 'T-0001', exited: false },
    { id: 't2', agent: 'c', exited: false },
    { id: 't3', agent: 'a', exited: true },
  ])
  expect(Object.fromEntries(tabs)).toEqual({ b: 't1', c: 't2' })
})

test('a task tab never claims a session that started before it', () => {
  const tabs = tabsOf([agent('a', '2026-10-22', { task: 'T-0001', started: '2026-10-20' })], [{ id: 't1', task: 'T-0001', exited: false, started: '2026-10-21' }])
  expect(tabs.size).toBe(0)
})

test('an older load that answers late does not overwrite a newer one', async () => {
  const set = vi.fn()
  const answers = [later<string>(), later<string>()]
  let asked = 0
  const vault = loader(() => answers[asked++].promise, set)
  const first = vault.load()
  const second = vault.load()
  await vi.waitFor(() => expect(asked).toBe(2))
  answers[1].settle('new')
  await second
  answers[0].settle('old')
  await first
  expect(set.mock.calls).toEqual([['new']])
})

test('typing saves once things go quiet, and closing saves what is still waiting', () => {
  vi.useFakeTimers()
  onTestFinished(() => { vi.useRealTimers() })
  const save = vi.fn()
  const typing = debounce(save, 700)
  typing('a')
  typing('ab')
  vi.advanceTimersByTime(700)
  expect(save.mock.calls).toEqual([['ab']])
  typing('abc')
  typing.flush()
  expect(save.mock.calls).toEqual([['ab'], ['abc']])
  // Nothing waiting: closing saves nothing.
  typing.flush()
  vi.advanceTimersByTime(700)
  expect(save).toHaveBeenCalledTimes(2)
})

test('a day on which the clocks change is still a whole day', () => {
  vi.stubEnv('TZ', 'Europe/Brussels')
  try {
    // 25 October 2026 has 25 hours there: the clocks go back.
    const { from, to } = dayRange(new Date(2026, 9, 25, 12))
    expect([from.getDate(), from.getHours()]).toEqual([25, 0])
    expect([to.getDate(), to.getHours()]).toEqual([26, 0])
  } finally {
    vi.unstubAllEnvs()
  }
})
