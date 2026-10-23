// Vault search for the board's search box.
import { search as ragSearch } from '../lib/rag.mjs'
import { listDocs } from '../lib/vault.mjs'

// Semantic hits first (local embeddings), then plain-text matches the embeddings missed.
// Falls back to plain text when Ollama isn't running.
export async function search(q: string) {
  const text = textSearch(q)
  try {
    const best = new Map<string, any>()
    for (const h of await ragSearch(q, 30, 1)) {
      if (h.score < 0.5) continue
      const [dir, f] = h.path.split('/')
      best.set(h.path, { path: h.path, dir, name: f.replace(/\.md$/, ''), title: h.text.split('\n')[0].replace(/ \(.*$/, ''), score: h.score, snippet: h.text.split('\n').slice(1).join(' ').slice(0, 200) })
    }
    for (const t of text) if (!best.has(t.path)) best.set(t.path, t)
    return [...best.values()].slice(0, 25)
  } catch {
    return text
  }
}

function textSearch(q: string) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return ['tasks', 'notes', 'inbox', 'meetings', 'projects'].flatMap((dir) => listDocs(dir).map((d) => {
    const text = `${d.data.title ?? d.data.name ?? d.name}\n${d.body}`
    const lower = text.toLowerCase()
    const score = terms.reduce((s, t) => s + (lower.split(t).length - 1), 0)
    const at = lower.indexOf(terms[0])
    return { path: `${dir}/${d.name}.md`, dir, name: d.name, title: d.data.title ?? d.name, score, snippet: at < 0 ? '' : text.slice(Math.max(0, at - 60), at + 140) }
  })).filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, 25)
}
