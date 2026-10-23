// The vault as one graph for the Brain Terrain page: docs are nodes; wikilinks (body and frontmatter,
// so a thought's `related` and `tasks` too), `project` fields and similar content (the RAG index) are edges.
import fs from 'node:fs'
import path from 'node:path'
import { similar } from '../lib/rag.mjs'
import { VAULT, listDocs } from '../lib/vault.mjs'
import type { GraphEdge, GraphNode, Kind, KnowledgeGraph, LinkKind } from './src/graph'
import { unlink } from './src/lib'

const DIRS: [string, Kind][] = [['projects', 'project'], ['tasks', 'task'], ['inbox', 'thought'], ['notes', 'thought'], ['meetings', 'meeting']]
const wikilinks = (text: string) => [...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim())
// Frontmatter typed by hand as `related: [[X]]` (unquoted) parses as a list in a list: that's a link too.
const frontLinks = (v: unknown): string[] => (typeof v === 'string' ? wikilinks(v)
  : Array.isArray(v) ? v.flatMap((x) => (Array.isArray(x) && x.length === 1 && typeof x[0] === 'string' ? [x[0].trim()] : frontLinks(x)))
  : v && typeof v === 'object' ? Object.values(v).flatMap(frontLinks) : [])

export function knowledgeGraph(): KnowledgeGraph {
  const docs = DIRS.flatMap(([dir, kind]) => listDocs(dir).map((d) => ({ ...d, id: `${dir}/${d.name}.md`, kind })))
  const projects = new Map(docs.filter((d) => d.kind === 'project').map((p) => [p.name, p]))
  // A wikilink names a file; the first folder in DIRS wins when two share a name.
  const byName = new Map<string, string>()
  for (const d of docs) if (!byName.has(d.name)) byName.set(d.name, d.id)

  const edges = new Map<string, GraphEdge>()
  // One edge per pair, the first kind found wins: project, then link, then similar.
  const add = (x: string, y: string, kind: LinkKind, score?: number) => {
    if (x === y) return
    const [a, b] = [x, y].sort()
    if (!edges.has(`${a}\n${b}`)) edges.set(`${a}\n${b}`, { a, b, kind, ...(score === undefined ? {} : { score }) })
  }
  const nodes: GraphNode[] = docs.map((d) => {
    const named = unlink(d.data.project)
    const project = d.kind === 'project' ? d.name : projects.has(named) ? named : ''
    const context = projects.get(project)?.data.context
    if (project && d.kind !== 'project') add(d.id, `projects/${project}.md`, 'project')
    return {
      id: d.id, kind: d.kind, name: d.name, title: String(d.data.title ?? d.data.name ?? d.name), project,
      contexts: context ? [String(context)] : [], status: String(d.data.status ?? ''),
    }
  })
  for (const d of docs) {
    for (const name of [...frontLinks(d.data), ...wikilinks(d.body)]) {
      const to = byName.get(name)
      if (to) add(d.id, to, 'link')
    }
  }

  // Teach reports are HTML, linked from a task or note by path; they belong to the project of the first one.
  const reportsDir = path.join(VAULT, 'reports')
  const reports = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).filter((f) => f.endsWith('.html')) : []
  for (const file of reports) {
    const id = `reports/${file}`
    const from = docs.filter((d) => d.body.includes(id))
    nodes.push({
      id, kind: 'report', name: file, title: file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.html$/, '').replace(/-/g, ' '),
      project: nodes.find((n) => n.id === from[0]?.id)?.project ?? '', contexts: [], status: '',
    })
    for (const d of from) add(d.id, id, 'link')
  }

  // A doc outside any project (most thoughts, some meetings, reports) is in the contexts of what it links to.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const own = new Map(nodes.map((n) => [n.id, n.contexts]))
  for (const e of edges.values()) {
    for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) {
      const n = byId.get(x)!
      if (!own.get(x)!.length) n.contexts = [...new Set([...n.contexts, ...own.get(y)!])]
    }
  }

  for (const s of similar()) if (byId.has(s.a) && byId.has(s.b)) add(s.a, s.b, 'similar', Math.round(s.score * 100) / 100)
  return { nodes, edges: [...edges.values()] }
}
