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

  const { data, body } = readDoc(taskFile)
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  const patch = {}
  if (!sessions.includes(sid)) patch.sessions = [...sessions, sid]
  if (data.status === 'todo' || data.status === 'ready') patch.status = 'wip'
  if (Object.keys(patch).length) updateDoc(taskFile, patch)

  const sessionFile = path.join(VAULT, 'sessions', `${sid}.md`)
  if (!fs.existsSync(sessionFile)) {
    const account = process.env.CLAUDE_CONFIG_DIR ? path.basename(process.env.CLAUDE_CONFIG_DIR).replace(/^\.claude-/, '') : 'dm'
    writeDoc(sessionFile, { task: `[[${id}]]`, started: new Date().toISOString(), cwd: input.cwd ?? '', account },
      `Claude Code session for [[${id}]].\n\nResume: \`cd ${input.cwd} && claude --resume ${sid}\`\n`)
  }

  // SessionStart stdout is added to Claude's context. The task itself goes in, not just its path:
  // a bare "read the file first" gets skipped and the agent guesses from the repo instead.
  const fields = ['project', 'status', 'priority', 'type', 'repo', 'branch', 'pr', 'due', 'blocked_by', 'sources', 'meetings']
    .map((k) => [k, Array.isArray(data[k]) ? data[k].join(', ') : data[k]])
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
  console.log([
    `This session works on task ${id}: "${data.title ?? ''}" (file: ${taskFile}).`,
    'The task below is what the user means by "this", "the PR", "the ticket" and so on; use its repo, branch and PR rather than guessing from the current checkout.',
    'Record decisions and progress in the task body.',
    '',
    `<task id="${id}">`,
    ...fields,
    '',
    body.trim() || '(no description yet)',
    '</task>',
  ].join('\n'))
} catch (e) {
  console.error(`second-brain hook: ${e.message}`)
}
