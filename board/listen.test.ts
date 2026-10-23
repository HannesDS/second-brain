import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'
import { WebSocket } from 'ws'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-listen-'))
vi.stubEnv('SECOND_BRAIN_VAULT', scratch)
const { RATE, Utterances, attachListen } = await import('./listen')
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))

// Synthetic audio: a 200 Hz tone stands in for speech, near-zero noise for a pause.
const tone = (s: number) => Int16Array.from({ length: s * RATE }, (_, i) => Math.round(Math.sin((2 * Math.PI * 200 * i) / RATE) * 6000))
const quiet = (s: number) => Int16Array.from({ length: s * RATE }, (_, i) => (i % 7) - 3)
const secs = (a: Int16Array) => a.length / RATE

// Feeds audio in 100 ms pieces, the way the browser sends it.
function feed(cut: InstanceType<typeof Utterances>, ...parts: Int16Array[]) {
  const out = []
  for (const p of parts) for (let i = 0; i < p.length; i += RATE / 10) out.push(...cut.push(p.subarray(i, i + RATE / 10)))
  return out
}

test('silence makes no utterances', () => {
  const cut = new Utterances(0)
  expect(feed(cut, quiet(5))).toEqual([])
  expect(cut.current()).toBeUndefined()
  expect(cut.end()).toBeUndefined()
})

test('a pause ends an utterance, which starts a little before the speech', () => {
  const cut = new Utterances(1_000_000)
  const [u, ...more] = feed(cut, quiet(2), tone(2), quiet(1))
  expect(more).toEqual([])
  expect(Math.abs(u.at - (1_000_000 + 2000 - 300))).toBeLessThanOrEqual(30) // one 30 ms frame
  expect(secs(u.audio)).toBeCloseTo(0.3 + 2 + 0.2, 1)
})

test('shows what is being said before the pause comes', () => {
  const cut = new Utterances(0)
  feed(cut, quiet(1), tone(1.5))
  expect(secs(cut.current()!.audio)).toBeCloseTo(1.8, 1)
})

test('two sentences with a pause between them are two utterances', () => {
  const cut = new Utterances(0)
  const us = feed(cut, quiet(1), tone(2), quiet(1), tone(3), quiet(1))
  expect(us.map((u) => u.at)).toEqual([690, 3690]) // on 30 ms frames
})

test('a short pause between words does not cut', () => {
  const cut = new Utterances(0)
  expect(feed(cut, quiet(1), tone(1), quiet(0.3), tone(1), quiet(1))).toHaveLength(1)
})

test('a click is not an utterance', () => {
  const cut = new Utterances(0)
  expect(feed(cut, quiet(1), tone(0.1), quiet(1))).toEqual([])
})

test('a long monologue is cut every 15 seconds at its quietest moment', () => {
  const cut = new Utterances(0)
  // A dip at 13.5 s, inside the last two seconds before the 15 s limit.
  const us = feed(cut, quiet(1), tone(13.2), quiet(0.3), tone(10))
  expect(us).toHaveLength(1)
  expect(secs(us[0].audio)).toBeGreaterThan(13.5)
  expect(secs(us[0].audio)).toBeLessThan(14.3)
  expect(cut.current()).toBeDefined()
  expect(secs(cut.end()!.audio)).toBeCloseTo(10.5, 0)
})

test('stopping mid-sentence still hands out the last words', () => {
  const cut = new Utterances(0)
  feed(cut, quiet(1), tone(2))
  expect(secs(cut.end()!.audio)).toBeCloseTo(2.3, 1)
  expect(cut.end()).toBeUndefined()
})

test('a speaking start is heard at once', () => {
  const cut = new Utterances(0)
  const [u] = feed(cut, tone(2), quiet(1))
  expect(u.at).toBe(0)
})

// /listen on a throwaway server; resolves how the socket ended.
async function connect(query: string, origin?: string) {
  fs.mkdirSync(path.join(scratch, 'meetings'), { recursive: true })
  fs.writeFileSync(path.join(scratch, 'meetings', 'Standup.md'), '')
  const server = http.createServer()
  attachListen(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const host = `127.0.0.1:${(server.address() as { port: number }).port}`
  const ws = new WebSocket(`ws://${host}/listen?${query}`, { origin: origin ?? `http://${host}` })
  return { ws, close: () => server.close() }
}

test('refuses other websites and unknown meetings', async () => {
  for (const [query, origin] of [['name=Standup', 'http://evil.example'], ['name=Retro', undefined], ['name=../meetings/Standup', undefined]]) {
    const { ws, close } = await connect(query!, origin)
    await expect(new Promise((ok, no) => { ws.on('open', ok); ws.on('error', no) })).rejects.toThrow()
    close()
  }
})

test('"end" closes the stream once what was said is saved', async () => {
  const { ws, close } = await connect('name=Standup&who=me')
  await new Promise((r) => ws.on('open', r))
  ws.send(Buffer.from(quiet(1).buffer))
  ws.send('end')
  const code = await new Promise((r) => ws.on('close', r))
  expect(code).toBe(1005)
  expect(fs.existsSync(path.join(scratch, 'transcripts', 'Standup.md'))).toBe(false)
  close()
})
