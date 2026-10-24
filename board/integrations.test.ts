import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, expect, test, vi } from 'vitest'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'integrations-'))
const bin = path.join(scratch, 'bin')
const model = path.join(scratch, 'model.bin')
process.env.SECOND_BRAIN_VAULT = path.join(scratch, 'vault')
process.env.WHISPER_MODEL = model
const { envVars, notion, ollama, onPath, whisper } = await import('./integrations')
const { redact } = await import('./calendar')
const { status: syncStatus } = await import('./sync')

const tool = (name: string, mode = 0o755) => {
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n', { mode })
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(() => { fs.rmSync(scratch, { recursive: true, force: true }) })

test('onPath finds executables only', () => {
  tool('runs')
  tool('plain', 0o644)
  expect(onPath('runs', `/nope${path.delimiter}${bin}`)).toBe(path.join(bin, 'runs'))
  expect(onPath('plain', bin)).toBe('')
  expect(onPath('runs', '')).toBe('')
})

test('envVars says which variables are set, never their values', () => {
  vi.stubEnv('SB_TEST_SET', 'secret-value')
  vi.stubEnv('SB_TEST_EMPTY', '')
  const out = envVars(['SB_TEST_SET', 'SB_TEST_EMPTY'])
  expect(out).toBe('SB_TEST_SET set · SB_TEST_EMPTY missing')
  expect(out).not.toContain('secret')
})

test('whisper needs whisper-server, whisper-cli, ffmpeg and the model, and reports the last transcript', () => {
  vi.stubEnv('PATH', bin)
  expect(whisper()).toMatchObject({ state: 'error', detail: expect.stringContaining('whisper-server, whisper-cli, ffmpeg, the model file'), lastRun: '' })
  tool('whisper-server')
  tool('whisper-cli')
  tool('ffmpeg')
  fs.writeFileSync(model, '')
  const transcript = path.join(process.env.SECOND_BRAIN_VAULT!, 'transcripts', 'Standup.md')
  fs.mkdirSync(path.dirname(transcript), { recursive: true })
  fs.writeFileSync(transcript, '')
  const out = whisper()
  expect(out.state).toBe('ok')
  expect(out.lastRun).toBe(fs.statSync(transcript).mtime.toISOString())
  expect(out.config).toContain(`ffmpeg: ${path.join(bin, 'ffmpeg')}`)
})

const tags = (names: string[]) => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: names.map((name) => ({ name })) }) })

test('ollama works once the embedding model is pulled', async () => {
  vi.stubGlobal('fetch', tags(['nomic-embed-text:latest']))
  expect((await ollama()).state).toBe('ok')
  vi.stubGlobal('fetch', tags(['llama3:8b']))
  expect(await ollama()).toMatchObject({ state: 'error', detail: expect.stringContaining('ollama pull nomic-embed-text') })
})

test('ollama down is an error, not a crash', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')))
  expect(await ollama()).toMatchObject({ state: 'error', detail: expect.stringContaining('ECONNREFUSED') })
})

test('notion is off without a token, and shows the last sync error', () => {
  Object.assign(syncStatus, { notion: 'ok', lastRun: '2026-10-23T08:00:00.000Z', error: '' })
  vi.stubEnv('NOTION_TOKEN', '')
  expect(notion()).toMatchObject({ state: 'off', lastRun: '' })
  vi.stubEnv('NOTION_TOKEN', 'secret_abc')
  expect(notion()).toMatchObject({ state: 'ok', lastRun: '2026-10-23T08:00:00.000Z' })
  Object.assign(syncStatus, { error: 'Notion 401: API token is invalid.' })
  expect(notion()).toMatchObject({ state: 'error', detail: 'Notion 401: API token is invalid.' })
  expect(JSON.stringify(notion())).not.toContain('secret_abc')
})

test('calendar errors keep the host, not the secret address', () => {
  const out = redact('request to https://calendar.google.com/calendar/ical/me%40x.com/private-abc123/basic.ics failed')
  expect(out).toBe('request to https://calendar.google.com failed')
  expect(redact('404 Not Found')).toBe('404 Not Found')
})
