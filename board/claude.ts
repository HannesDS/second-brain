// Environment for running the `claude` CLI on behalf of the board.
import os from 'node:os'
import path from 'node:path'

// The workbench is a personal project: its own Claude runs (assistant, filing, plain shells) use this account.
// Project chats and terminals still use the project's own account.
export const WORKBENCH_ACCOUNT = 'personal'

export function claudeEnv(account: string, extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, SECOND_BRAIN_CHAT: '1', ...extra }
  // Set when the board itself was started from a Claude session; would make these runs look interactive.
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  delete env.CLAUDE_CONFIG_DIR
  if (!extra.TASK_ID) delete env.TASK_ID
  if (account !== 'dm') env.CLAUDE_CONFIG_DIR = path.join(os.homedir(), `.claude-${account}`)
  return env
}
