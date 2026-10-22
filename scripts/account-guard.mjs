#!/usr/bin/env node
// Project SessionStart hook: this repo is personal work, so warn when a session runs on the Data Minded account.
const dir = process.env.CLAUDE_CONFIG_DIR ?? ''
if (!dir.endsWith('.claude-personal')) {
  console.log(JSON.stringify({
    systemMessage: '⚠ second-brain is a personal project but this session uses the Data Minded account. Quit and start it with: cd ~/Projects/second-brain && cpers',
  }))
}
