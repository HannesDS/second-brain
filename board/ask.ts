// Ask the vault: a local LLM (Ollama) answers a question from the docs search finds for it, citing them as [n].
import path from 'node:path'
import { OLLAMA } from '../lib/rag.mjs'
import { VAULT, readDoc } from '../lib/vault.mjs'
import { search } from './search'

export const ASK_MODEL = process.env.OLLAMA_ASK_MODEL ?? 'qwen3.8'
const SOURCES = 8
const SOURCE_CHARS = 4000

// Answers only from the best hits inside `within` (the docs the Brain Terrain shows). `sources[n - 1]` is what [n] cites.
// No hits means no model call: an empty answer.
export async function ask(q: string, within?: string[]) {
  const sources = (await search(q, within)).slice(0, SOURCES).map((h: any) => ({ path: h.path as string, title: h.title as string }))
  if (!sources.length) return { answer: '', sources }
  const docs = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.path})\n${readDoc(path.join(VAULT, s.path)).body.trim().slice(0, SOURCE_CHARS)}`)
  const prompt = `Answer the user's question from the SOURCES below, docs from their second-brain vault. Use nothing else.
Cite every claim with the source number in square brackets, like [2] or [1][3]. If the sources don't answer it, say so in one sentence.
Keep it short: a few sentences or a short list. Plain text, no headings.

QUESTION: ${q}

SOURCES:
${docs.join('\n\n')}`
  // No thinking: a short answer matters more here than a careful one, and it keeps a local model quick.
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model: ASK_MODEL, messages: [{ role: 'user', content: prompt }], stream: false, think: false }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
  return { answer: String((await res.json()).message?.content ?? '').trim(), sources }
}
