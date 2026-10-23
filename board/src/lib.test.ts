import { expect, test, vi } from 'vitest'
import { loader, prReport, teachPrompt, todayISO, type Doc } from './lib'

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
