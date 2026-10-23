// Semantic search over the vault: chunks every markdown file, embeds the chunks with a local
// Ollama model, and keeps the index in state/rag.json. Only files whose content changed are re-embedded.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { settle } from './settle.mjs'
import { ROOT, VAULT, readDoc } from './vault.mjs'

export const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434'
export const MODEL = 'nomic-embed-text'
export const INDEX = path.join(ROOT, 'state', 'rag.json')
const DIRS = ['tasks', 'notes', 'inbox', 'meetings', 'projects', 'sessions', 'transcripts']
const CHUNK_CHARS = 1200

let index = load()

function load() {
  try {
    const i = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
    if (i.model === MODEL) return i
  } catch { /* no index yet */ }
  return { model: MODEL, files: {} }
}

async function embed(texts) {
  const out = []
  for (let i = 0; i < texts.length; i += 32) {
    const res = await fetch(`${OLLAMA}/api/embed`, {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, input: texts.slice(i, i + 32) }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
    out.push(...(await res.json()).embeddings)
  }
  // Normalised (and rounded, to keep the index small), so search is a dot product.
  return out.map((v) => {
    const n = Math.hypot(...v) || 1
    return v.map((x) => Math.round((x / n) * 1e4) / 1e4)
  })
}

// Paragraph-ish chunks; each carries the file's title and path so a hit makes sense on its own.
function chunk(rel) {
  const { data, body } = readDoc(path.join(VAULT, rel))
  const title = data.title ?? data.name ?? path.basename(rel, '.md')
  const facts = ['project', 'status', 'priority', 'date'].filter((k) => data[k]).map((k) => `${k}: ${data[k]}`).join(', ')
  const head = `${title} (${rel}${facts ? `; ${facts}` : ''})`
  const parts = body.split(/\n(?=#{1,4} )|\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const chunks = []
  let cur = ''
  for (const p of parts) {
    if (cur && cur.length + p.length > CHUNK_CHARS) { chunks.push(cur); cur = '' }
    cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur || !chunks.length) chunks.push(cur)
  return chunks.map((c) => `${head}\n${c.slice(0, CHUNK_CHARS * 2)}`)
}

function vaultFiles() {
  return DIRS.flatMap((dir) => {
    const full = path.join(VAULT, dir)
    return fs.existsSync(full) ? fs.readdirSync(full).filter((f) => f.endsWith('.md')).map((f) => `${dir}/${f}`) : []
  })
}

let running = Promise.resolve()

// Brings the index up to date. Serialised, so overlapping calls never embed the same file twice.
export function refresh() {
  running = running.catch(() => {}).then(async () => {
    const files = vaultFiles()
    let embedded = 0
    for (const rel of files) {
      const hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(VAULT, rel))).digest('hex')
      if (index.files[rel]?.hash === hash) continue
      const texts = chunk(rel)
      const vecs = await embed(texts.map((t) => `search_document: ${t}`))
      index.files[rel] = { hash, chunks: texts.map((text, i) => ({ text, vec: vecs[i] })) }
      embedded++
    }
    for (const rel of Object.keys(index.files)) if (!files.includes(rel)) { delete index.files[rel]; embedded++ }
    if (embedded) {
      fs.mkdirSync(path.dirname(INDEX), { recursive: true })
      fs.writeFileSync(INDEX, JSON.stringify(index))
    }
    return { files: files.length, embedded }
  })
  return running
}

const soon = settle(() => refresh().catch((e) => console.error(`rag: ${e.message}`)))
export const refreshSoon = (wait = 2000) => soon(wait)

// Best chunks for a question, at most `perFile` per file so one long note can't crowd out the rest.
export async function search(query, k = 8, perFile = 2) {
  await refresh()
  const [q] = await embed([`search_query: ${query}`])
  const hits = []
  for (const [rel, f] of Object.entries(index.files)) {
    for (const c of f.chunks) {
      let score = 0
      for (let i = 0; i < q.length; i++) score += q[i] * c.vec[i]
      hits.push({ path: rel, text: c.text, score })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  const seen = {}
  return hits.filter((h) => (seen[h.path] = (seen[h.path] ?? 0) + 1) <= perFile).slice(0, k)
}

// Compact block of retrieved notes for a prompt. Empty when Ollama is down, so callers degrade gracefully.
export async function context(query, k = 6) {
  try {
    const hits = await search(query, k, 1)
    return hits.filter((h) => h.score > 0.45).map((h) => `- ${h.path}: ${h.text.split('\n').slice(1).join(' ').slice(0, 400)}`).join('\n')
  } catch {
    return ''
  }
}
