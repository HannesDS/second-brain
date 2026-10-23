import { expect, test } from 'vitest'
import { prReport, teachPrompt, todayISO, type Doc } from './lib'

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
