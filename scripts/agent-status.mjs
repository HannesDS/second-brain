#!/usr/bin/env node
// Claude Code hook for every session in both accounts: records whether the agent is
// working, waiting for you, or ended, so the workbench can show one overview.
// Writes state/agents/<session>.json (gitignored). Must never fail the session.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIR = path.join(ROOT, 'state', 'agents')

const STATE = {
  SessionStart: 'idle',
  UserPromptSubmit: 'working',
  PostToolUse: 'working',
  Notification: 'needs-input',
  Stop: 'needs-input',
  SessionEnd: 'ended',
}

// Last assistant text from the transcript tail (Stop doesn't always carry it).
function lastAssistantText(transcript) {
  try {
    const fd = fs.openSync(transcript, 'r')
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, 256 * 1024)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    fs.closeSync(fd)
    const lines = buf.toString('utf8').split('\n').reverse()
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue
      try {
        const ev = JSON.parse(line)
        const text = (ev.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
        if (ev.type === 'assistant' && text) return text
      } catch { /* partial first line */ }
    }
  } catch { /* no transcript */ }
  return ''
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  const id = input.session_id
  const state = STATE[input.hook_event_name]
  if (!id || !state || !/^[\w-]+$/.test(id)) process.exit(0)

  const file = path.join(DIR, `${id}.json`)
  let prev = {}
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* new session */ }
  // PostToolUse fires constantly; skip the write unless it changes the state.
  if (input.hook_event_name === 'PostToolUse' && prev.state === 'working') process.exit(0)

  const next = {
    ...prev,
    id,
    cwd: input.cwd ?? prev.cwd ?? '',
    account: process.env.CLAUDE_CONFIG_DIR ? path.basename(process.env.CLAUDE_CONFIG_DIR).replace(/^\.claude-?/, '') || 'dm' : 'dm',
    task: process.env.TASK_ID ?? prev.task ?? '',
    source: process.env.SECOND_BRAIN_CHAT ? 'board-chat' : prev.source ?? '',
    state,
    event: input.hook_event_name,
    updated: new Date().toISOString(),
    started: prev.started ?? new Date().toISOString(),
    transcript: input.transcript_path ?? prev.transcript ?? '',
  }
  if (input.hook_event_name === 'UserPromptSubmit') {
    next.lastPrompt = String(input.prompt ?? '').slice(0, 300)
    next.title ??= next.lastPrompt.split('\n')[0].slice(0, 90)
  }
  if (input.hook_event_name === 'Notification') next.message = String(input.message ?? '').slice(0, 300)
  if (input.hook_event_name === 'Stop') {
    next.message = (input.last_assistant_message || lastAssistantText(next.transcript)).slice(-400)
  }
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2))
} catch (e) {
  console.error(`agent-status hook: ${e.message}`)
}
