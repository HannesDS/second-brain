import { expect, test } from 'vitest'
import { echoes, prReport, teachPrompt, todayISO, type Doc } from './lib'

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

test('a tab skips the echo of its own drop, but reloads for other changes', () => {
  const echo = echoes('me')
  expect(echo.needsReload('me')).toBe(false)
  expect(echo.needsReload('other tab')).toBe(true)
  expect(echo.needsReload(undefined)).toBe(true)
})

test('a drop during a reload gets its echo reloaded, once', async () => {
  const echo = echoes('me')
  let done = () => {}
  const reload = echo.loading(new Promise<void>((r) => { done = r }))
  echo.dropped()
  done()
  await reload
  expect(echo.needsReload('me')).toBe(true)
  expect(echo.needsReload('me')).toBe(false)
  // With no reload on its way, a drop's echo is skipped as before.
  echo.dropped()
  expect(echo.needsReload('me')).toBe(false)
})

