// Ask the vault: Claude answers a question from the docs search finds for it, citing them as [n].
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { ROOT, VAULT, readDoc } from '../lib/vault.mjs'
import { WORKBENCH_ACCOUNT, claudeEnv } from './claude'
import { search } from './search'

const run = promisify(execFile)
const SOURCES = 8
const SOURCE_CHARS = 4000

// Answers only from the best hits inside `within` (the docs the Brain Terrain shows). `sources[n - 1]` is what [n] cites.
// No hits means no Claude call: an empty answer.
export async function ask(q: string, within?: string[]) {
  const sources = (await search(q, within)).slice(0, SOURCES).map((h: any) => ({ path: h.path as string, title: h.title as string }))
  if (!sources.length) return { answer: '', sources }
  const docs = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.path})\n${readDoc(path.join(VAULT, s.path)).body.trim().slice(0, SOURCE_CHARS)}`)
  const prompt = `Answer the user's question from the SOURCES below, docs from their second-brain vault. Use nothing else.
Cite every claim with the source number in square brackets, like [2] or [1][3]. If the sources don't answer it, say so in one sentence.
Keep it short: a few sentences or a short list. Plain text, no headings. Do not use tools.

QUESTION: ${q}

SOURCES:
${docs.join('\n\n')}`
  // No tools, so Claude can't read docs outside the filters.
  const { stdout } = await run('claude', ['-p', '--output-format', 'json', '--model', 'sonnet', '--tools', '', prompt], {
    cwd: ROOT, env: claudeEnv(WORKBENCH_ACCOUNT), timeout: 180_000, maxBuffer: 10 * 1024 * 1024,
  })
  return { answer: String(JSON.parse(stdout).result ?? '').trim(), sources }
}
