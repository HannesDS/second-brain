// Meetings: notes from the Notion template, live transcription with local Whisper, and an agent
// that turns the notes + transcript into a summary, action points and tasks (you approve).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { VAULT, readDoc, writeDoc } from '../lib/vault.mjs'

const run = promisify(execFile)
export const MODEL = process.env.WHISPER_MODEL ?? path.join(os.homedir(), '.cache/whisper/ggml-large-v3-turbo-q5_0.bin')

// Same sections as the Notion "Meeting notes" template. The transcript lives in transcripts/
// (embedded below) so recording never fights with you typing in the note.
export function createMeeting({ title, date, time, project, attendees }: { title: string; date: string; time?: string; project?: string; attendees?: string[] }) {
  const name = `${date} ${String(title).replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Meeting'}`
  const rel = `meetings/${name}.md`
  const file = path.join(VAULT, rel)
  if (!fs.existsSync(file)) {
    writeDoc(file, { date, time: time ?? '', project: project ? `[[${project}]]` : '', attendees: attendees ?? [], tasks: [] },
      `## Summary\n\n\n## Context\n\n\n## Notes\n\n\n## Action Points\n\n- [ ] \n\n## Transcription\n\n![[transcripts/${name}]]\n`)
  }
  return { path: rel, name }
}

export const transcriptPath = (name: string) => path.join(VAULT, 'transcripts', `${name}.md`)

export function readTranscript(name: string) {
  const f = transcriptPath(name)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}

// One chunk at a time per process: Whisper uses the whole GPU anyway, and chunks must stay in order.
let queue = Promise.resolve()

export function transcribeChunk(name: string, audio: Buffer, startedAt: string) {
  const job = queue.then(async () => {
    if (!fs.existsSync(MODEL)) throw new Error(`Whisper model missing at ${MODEL}`)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rec-'))
    try {
      const input = path.join(dir, 'in.webm')
      const wav = path.join(dir, 'in.wav')
      fs.writeFileSync(input, audio)
      await run('ffmpeg', ['-loglevel', 'error', '-i', input, '-ar', '16000', '-ac', '1', wav])
      const { stdout } = await run('whisper-cli', ['-m', MODEL, '-f', wav, '-l', 'auto', '-nt', '-np'], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 })
      const text = stdout.replace(/\s+/g, ' ').trim()
      // Whisper hallucinates these on silence.
      if (!text || /^\[?(BLANK_AUDIO|silence|music)\]?$|^(thank you\.?|bedankt\.?)$/i.test(text)) return ''
      const f = transcriptPath(name)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      if (!fs.existsSync(f)) fs.writeFileSync(f, `---\nmeeting: "[[${name}]]"\n---\n`)
      const stamp = new Date(startedAt || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      fs.appendFileSync(f, `\n**${stamp}** ${text}\n`)
      return text
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
  queue = job.then(() => {}, () => {})
  return job
}

// Replaces the content of one "## Heading" section, keeping the rest of the note as it is.
export function setSection(body: string, heading: string, content: string) {
  const re = new RegExp(`(^## ${heading}[^\\n]*\\n)([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm')
  if (re.test(body)) return body.replace(re, `$1\n${content.trim()}\n\n`)
  return `${body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`
}

export function meetingContext(rel: string) {
  const name = path.basename(rel, '.md')
  const { data } = readDoc(path.join(VAULT, rel))
  const transcript = readTranscript(name).replace(/^---[\s\S]*?---\n/, '')
  return { name, data, transcript }
}
