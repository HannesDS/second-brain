#!/usr/bin/env node
// Installs the session hook and skills into both Claude accounts, plus shell aliases. Safe to re-run.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from '../lib/vault.mjs'

const HOME = os.homedir()
const SKILLS = ['task', 'grill', 'teach']
const script = (name) => `node "${path.join(ROOT, 'scripts', name)}"`
// event -> scripts. session-start links $TASK_ID sessions; agent-status feeds the agents overview.
const HOOKS = {
  SessionStart: ['session-start.mjs', 'agent-status.mjs'],
  UserPromptSubmit: ['agent-status.mjs'],
  PostToolUse: ['agent-status.mjs'],
  Notification: ['agent-status.mjs'],
  Stop: ['agent-status.mjs'],
  SessionEnd: ['agent-status.mjs'],
}

for (const name of ['.claude', '.claude-personal']) {
  const dir = path.join(HOME, name)
  if (!fs.existsSync(dir)) { console.log(`skip ${dir}: missing (log in to that account first)`); continue }

  fs.mkdirSync(path.join(dir, 'skills'), { recursive: true })
  for (const skill of SKILLS) {
    const link = path.join(dir, 'skills', skill)
    const stat = fs.lstatSync(link, { throwIfNoEntry: false })
    if (stat && !stat.isSymbolicLink()) { console.log(`skip ${link}: a real folder exists there`); continue }
    if (stat) fs.unlinkSync(link)
    fs.symlinkSync(path.join(ROOT, '.claude/skills', skill), link)
  }

  const file = path.join(dir, 'settings.json')
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  let changed = false
  for (const [event, scripts] of Object.entries(HOOKS)) {
    const hooks = ((settings.hooks ??= {})[event] ??= [])
    for (const name of scripts) {
      if (JSON.stringify(hooks).includes(name)) continue
      hooks.push({ hooks: [{ type: 'command', command: script(name), timeout: 10 }] })
      changed = true
    }
  }
  if (changed) {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
  }
  console.log(`ok ${dir}: skills ${SKILLS.join(', ')} + hooks ${Object.keys(HOOKS).join(', ')}`)
}

const zshrc = path.join(HOME, '.zshrc')
const rc = fs.existsSync(zshrc) ? fs.readFileSync(zshrc, 'utf8') : ''
if (!rc.includes('alias cdm=')) {
  fs.appendFileSync(zshrc, `\n# second-brain: one alias per Claude account\nalias cdm='claude'\nalias cpers='CLAUDE_CONFIG_DIR=$HOME/.claude-personal claude'\n`)
  console.log('ok ~/.zshrc: aliases cdm, cpers (open a new shell)')
}
