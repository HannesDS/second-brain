#!/usr/bin/env node
// Claude Code SessionStart hook: links the session to the task in $TASK_ID.
// Installed at user level (both accounts), so it must stay silent when TASK_ID is unset.
import fs from 'node:fs'
import path from 'node:path'
import { ID, VAULT, readDoc, updateDoc, writeDoc } from '../lib/vault.mjs'

const id = process.env.TASK_ID
if (!id) process.exit(0)

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  const sid = input.session_id
  const taskFile = path.join(VAULT, 'tasks', `${id}.md`)
  if (!sid || !ID.test(id) || !fs.existsSync(taskFile)) {
    console.error(`second-brain: task ${id} not found, session not linked`)
    process.exit(0)
  }

  const { data } = readDoc(taskFile)
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  const patch = {}
  if (!sessions.includes(sid)) patch.sessions = [...sessions, sid]
  if (data.status === 'todo') patch.status = 'wip'
  if (Object.keys(patch).length) updateDoc(taskFile, patch)

  const sessionFile = path.join(VAULT, 'sessions', `${sid}.md`)
  if (!fs.existsSync(sessionFile)) {
    const account = process.env.CLAUDE_CONFIG_DIR ? path.basename(process.env.CLAUDE_CONFIG_DIR).replace(/^\.claude-/, '') : 'dm'
    writeDoc(sessionFile, { task: `[[${id}]]`, started: new Date().toISOString(), cwd: input.cwd ?? '', account },
      `Claude Code session for [[${id}]].\n\nResume: \`cd ${input.cwd} && claude --resume ${sid}\`\n`)
  }

  // SessionStart stdout is added to Claude's context.
  console.log(`This session works on task ${id}: "${data.title ?? ''}". Task file: ${taskFile}. Read it first; record decisions and progress in its body.`)
} catch (e) {
  console.error(`second-brain hook: ${e.message}`)
}
