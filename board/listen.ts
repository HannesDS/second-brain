// Live meeting transcription, the way whisper-stream works but fed by the browser: each source (your
// mic, the call's audio) streams 16 kHz PCM over its own WebSocket on /listen. Speech is cut into
// utterances at pauses; while one is spoken the board shows a preview, and each finished utterance is
// written to the transcript. Whisper stays loaded in a whisper-server child while anyone listens.
import { spawn, type ChildProcess } from 'node:child_process'
import type { IncomingMessage, Server } from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { WHISPER_MODEL, appendTranscript, cleanText, meetingName, requireModel } from './meetings'
import { SPEAKERS, type Speaker } from './src/lib'
import { trusted } from './terminal'

export const RATE = 16_000
const FRAME_MS = 30 // the step the speech detector looks at
const FRAME = (RATE * FRAME_MS) / 1000
// In frames:
const PREROLL = 10 // kept before speech starts, so the first syllable isn't cut off
const PAUSE = 23 // ~700 ms of quiet ends an utterance
const TAIL = 7 // ~200 ms of that quiet stays on the end
const MIN_VOICED = 10 // under ~300 ms of speech it was a click or a cough
const LONGEST = 500 // 15 s: a longer utterance is cut at the quietest moment of its last 2 s
const CUT_WINDOW = 66 // ~2 s
const MIN_LEVEL = 0.006 // RMS of full scale; quieter is never speech
const PREVIEW_MS = 1500
const PREVIEW_MIN = RATE // under a second Whisper guesses ("you")

export type Utterance = { audio: Int16Array; at: number }

const concat = (parts: Int16Array[]) => {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) { out.set(p, i); i += p.length }
  return out
}
const rms = (f: Int16Array) => Math.sqrt(f.reduce((s, x) => s + x * x, 0) / f.length) / 32768

// Cuts a stream of samples into utterances at pauses. `t0` is when the first sample was heard.
export class Utterances {
  private frames: Int16Array[] = []
  private levels: number[] = []
  private voice: boolean[] = []
  private rest = new Int16Array(0)
  private heard = 0
  private speaking = false
  private quiet = 0
  private floor = MIN_LEVEL
  constructor(private t0: number) {}

  push(pcm: Int16Array) {
    const all = concat([this.rest, pcm])
    const out: Utterance[] = []
    let i = 0
    for (; i + FRAME <= all.length; i += FRAME) {
      const u = this.frame(all.slice(i, i + FRAME))
      if (u) out.push(u)
    }
    this.rest = all.slice(i)
    return out
  }

  // What is being said right now, for a preview.
  current() { return this.speaking ? this.take(this.frames.length) : undefined }

  // The stream ended: whatever was still being said.
  end() { return this.speaking ? this.finish(this.frames.length) : undefined }

  private frame(f: Int16Array) {
    const level = rms(f)
    // The noise floor follows quiet at once and loudness slowly, so steady background noise isn't speech.
    this.floor = level < this.floor ? level : this.floor + (level - this.floor) * 0.0005
    const voice = level > Math.max(MIN_LEVEL, this.floor * 3)
    this.heard++
    this.frames.push(f)
    this.levels.push(level)
    this.voice.push(voice)
    if (!this.speaking) {
      this.speaking = voice
      this.quiet = 0
      if (!voice && this.frames.length > PREROLL) this.drop(1)
      return
    }
    this.quiet = voice ? 0 : this.quiet + 1
    if (this.quiet >= PAUSE) return this.finish(this.frames.length - this.quiet + TAIL)
    if (this.frames.length >= LONGEST) {
      let cut = this.frames.length - CUT_WINDOW
      for (let i = cut; i < this.frames.length; i++) if (this.levels[i] < this.levels[cut]) cut = i
      return this.finish(cut + 1)
    }
  }

  private take(n: number): Utterance {
    return { audio: concat(this.frames.slice(0, n)), at: this.t0 + (this.heard - this.frames.length) * FRAME_MS }
  }

  private drop(n: number) {
    this.frames.splice(0, n)
    this.levels.splice(0, n)
    this.voice.splice(0, n)
  }

  // Hands out the first n frames; what follows them is either still speech or the next pre-roll.
  private finish(n: number) {
    const u = this.take(n)
    const voiced = this.voice.slice(0, n).filter(Boolean).length
    this.drop(n)
    this.speaking = this.voice.includes(true)
    if (!this.speaking) this.drop(Math.max(0, this.frames.length - PREROLL))
    this.quiet = this.voice.length - 1 - this.voice.lastIndexOf(true)
    return voiced >= MIN_VOICED ? u : undefined
  }
}

// whisper-server keeps the model loaded, so a short clip takes ~0.4 s instead of ~1 s with whisper-cli.
let server: Promise<string> | undefined
let proc: ChildProcess | undefined
let listeners = 0
let idle: NodeJS.Timeout | undefined

const whisperServer = () => server ??= startServer().catch((e) => { stopServer(); throw e })

function stopServer() {
  clearTimeout(idle)
  proc?.kill()
  proc = undefined
  server = undefined
}
process.on('exit', () => proc?.kill())

async function startServer() {
  requireModel()
  const port = await new Promise<number>((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => resolve(port))
    }).on('error', reject)
  })
  const p = proc = spawn('whisper-server', ['-m', WHISPER_MODEL, '--host', '127.0.0.1', '--port', String(port), '-l', 'auto', '-nt'], { stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  p.stderr?.on('data', (d) => { log = (log + d).slice(-500) })
  let dead = false
  const failed = new Promise<never>((_, reject) => {
    p.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ENOENT' ? new Error('whisper-server not found: install it with `brew install whisper-cpp`') : e))
    p.on('exit', (code) => {
      dead = true
      if (proc === p) { proc = undefined; server = undefined }
      reject(new Error(`whisper-server stopped (exit ${code}): ${log.trim().split('\n').at(-1) ?? ''}`))
    })
  })
  failed.catch(() => {})
  const url = `http://127.0.0.1:${port}`
  const ready = async () => {
    for (let i = 0; i < 600 && !dead; i++) {
      try { await fetch(url); return } catch { await new Promise((r) => setTimeout(r, 100)) }
    }
    throw new Error('whisper-server did not start within a minute')
  }
  await Promise.race([failed, ready()])
  return url
}

// 16 kHz mono PCM as a WAV file, which is what whisper-server reads.
function wav(audio: Int16Array) {
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + audio.byteLength, 4); head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36); head.writeUInt32LE(audio.byteLength, 40)
  return Buffer.concat([head, Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength)])
}

async function whisper(audio: Int16Array) {
  const form = new FormData()
  form.append('file', new Blob([wav(audio)], { type: 'audio/wav' }), 'clip.wav')
  form.append('response_format', 'json')
  const res = await fetch(`${await whisperServer()}/inference`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`whisper-server: ${res.status} ${await res.text()}`)
  return cleanText(((await res.json()) as { text?: string }).text ?? '')
}

// Finished utterances of one meeting, from all its sources, are written one at a time in the order
// they ended. While any wait, previews pause: the transcript comes first.
const writing = new Map<string, Promise<void>>()
let waiting = 0

function write(name: string, u: Utterance, speaker: Speaker | undefined, done: (text: string) => void, failed: (e: Error) => void) {
  waiting++
  const job = (writing.get(name) ?? Promise.resolve()).then(async () => {
    // A crashed whisper-server restarts on the next request: one retry, so the sentence isn't lost.
    const text = await whisper(u.audio).catch(() => whisper(u.audio))
    if (text) appendTranscript(name, text, u.at, speaker)
    done(text)
  }).catch(failed).finally(() => { waiting-- })
  writing.set(name, job)
  return job
}

// One source of one meeting. Frames: binary = PCM, the text "end" = stopped (the last words still get saved).
function listen(ws: WebSocket, name: string, speaker?: Speaker) {
  const utterances = new Utterances(Date.now())
  let written = Promise.resolve()
  let handedOut = 0 // a preview of an utterance that has since been handed out is stale
  let previewing = false
  let lastPreview = 0
  let ended = false
  const send = (msg: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)) }
  const save = (u?: Utterance) => {
    if (!u) return
    handedOut++
    written = write(name, u, speaker, (text) => send({ final: text }), (e) => send({ error: e.message }))
  }
  const end = () => {
    if (ended) return written
    ended = true
    save(utterances.end())
    return written
  }
  const preview = () => {
    const now = utterances.current()
    if (!now || now.audio.length < PREVIEW_MIN || previewing || waiting || Date.now() - lastPreview < PREVIEW_MS) return
    previewing = true
    lastPreview = Date.now()
    const turn = handedOut
    whisper(now.audio)
      .then((text) => { if (turn === handedOut) send({ partial: text }) }, () => {})
      .finally(() => { previewing = false })
  }
  ws.on('message', (raw: Buffer, binary) => {
    if (ended) return
    if (!binary) {
      if (String(raw) === 'end') end().then(() => ws.close())
      return
    }
    for (const u of utterances.push(new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + (raw.length & ~1))))) save(u)
    preview()
  })
  ws.on('error', () => {}) // a bad frame; 'close' follows
  ws.on('close', () => {
    end()
    if (--listeners === 0) idle = setTimeout(stopServer, 60_000)
  })
  listeners++
  clearTimeout(idle)
}

export function attachListen(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://local')
    if (url.pathname !== '/listen') return
    if (!trusted(req)) return void socket.destroy()
    let name: string
    try { name = meetingName(url.searchParams.get('name')) } catch { return void socket.destroy() }
    const who = url.searchParams.get('who') ?? ''
    wss.handleUpgrade(req, socket, head, (ws) => listen(ws, name, Object.hasOwn(SPEAKERS, who) ? who as Speaker : undefined))
  })
  server.on('close', stopServer)
}
