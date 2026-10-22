// Environment for running the `claude` CLI on behalf of the board.
import os from 'node:os'
import path from 'node:path'

// The workbench is a personal project: its own Claude runs (assistant, filing, plain shells) use this account.
// Project chats and terminals still use the project's own account.
export const WORKBENCH_ACCOUNT = 'personal'

// Environment for a Claude the board starts, for the given account. Every inherited CLAUDE* variable is
// dropped: when the board was started from inside a Claude session they carry that session's identity
// (session id, child-session marker that turns transcript saving off, messaging socket and token).
export function cleanEnv(account: string, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^CLAUDE/.test(k) && k !== 'TASK_ID' && k !== 'SECOND_BRAIN_CHAT') env[k] = v
  }
  if (account !== 'dm') env.CLAUDE_CONFIG_DIR = path.join(os.homedir(), `.claude-${account}`)
  return { ...env, ...extra }
}

// Headless runs (chat, filing): marked so the agents overview leaves them out.
export const claudeEnv = (account: string, extra: Record<string, string> = {}) => cleanEnv(account, { SECOND_BRAIN_CHAT: '1', ...extra })
