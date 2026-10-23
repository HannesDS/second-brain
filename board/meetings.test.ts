import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, expect, test, vi } from 'vitest'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-meetings-'))
const model = path.join(scratch, 'model.bin')
vi.stubEnv('SECOND_BRAIN_VAULT', scratch)
vi.stubEnv('WHISPER_MODEL', model)
const { meetingName, setSection, transcribe } = await import('./meetings')

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))
afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('SECOND_BRAIN_VAULT', scratch); vi.stubEnv('WHISPER_MODEL', model) })

test('says where the Whisper model should be when it is missing', async () => {
  await expect(transcribe(Buffer.from('x'))).rejects.toThrow(`Whisper model missing at ${model}`)
})

test('says how to install ffmpeg when it is not on the PATH', async () => {
  fs.writeFileSync(model, '')
  vi.stubEnv('PATH', scratch)
  await expect(transcribe(Buffer.from('x'))).rejects.toThrow('ffmpeg not found: install it with `brew install ffmpeg`')
})

test('says how to install Whisper when ffmpeg is there but whisper-cli is not', async () => {
  fs.writeFileSync(model, '')
  // A stand-in ffmpeg that just writes its output file (the last argument).
  const bin = path.join(scratch, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'ffmpeg'), '#!/bin/sh\nfor a; do out="$a"; done\n: > "$out"\n', { mode: 0o755 })
  vi.stubEnv('PATH', bin)
  await expect(transcribe(Buffer.from('x'))).rejects.toThrow('whisper-cli not found: install it with `brew install whisper-cpp`')
})

test('a section keeps $ signs in the new text as they are', () => {
  const body = '## Summary\n\nold\n\n## Notes\n\nmine\n'
  expect(setSection(body, 'Summary', 'Budget is $2 million, see $& and $1')).toBe('## Summary\n\nBudget is $2 million, see $& and $1\n\n## Notes\n\nmine\n')
})

test('a meeting name cannot reach outside meetings/', () => {
  fs.mkdirSync(path.join(scratch, 'meetings'), { recursive: true })
  fs.mkdirSync(path.join(scratch, 'tasks'), { recursive: true })
  fs.writeFileSync(path.join(scratch, 'meetings', '2026-10-23 Standup.md'), '')
  fs.writeFileSync(path.join(scratch, 'tasks', 'T-0001.md'), '')
  expect(meetingName('2026-10-23 Standup')).toBe('2026-10-23 Standup')
  expect(() => meetingName('../tasks/T-0001')).toThrow('no meeting note')
})
