#!/usr/bin/env node
// Semantic search over the vault from any shell or Claude session:
//   node ~/Projects/second-brain/scripts/vault-search.mjs "dashboard consumption options"
import { search } from '../lib/rag.mjs'

const query = process.argv.slice(2).join(' ').trim()
if (!query) { console.error('usage: vault-search.mjs <question>'); process.exit(1) }
try {
  for (const h of await search(query, 10)) {
    console.log(`${h.score.toFixed(2)}  vault/${h.path}\n      ${h.text.split('\n').slice(1).join(' ').slice(0, 220)}\n`)
  }
} catch (e) {
  console.error(`vault-search: ${e.message} (is Ollama running with nomic-embed-text?)`)
  process.exit(1)
}
