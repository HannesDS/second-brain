// The vault as one graph for the Brain Terrain page: docs are nodes; wikilinks (body and frontmatter,
// so a thought's `related` and `tasks` too), `project` fields and similar content (the RAG index) are edges.
// Learning folders are lakes with a stream to the work they fed; sessions, meetings and thoughts of the
// last days are the walk.
import fs from 'node:fs'
import path from 'node:path'
import { similar } from '../lib/rag.mjs'
import { VAULT, listDocs, readDoc } from '../lib/vault.mjs'
import type { GraphEdge, GraphNode, Kind, KnowledgeGraph, LinkKind, WalkStep } from './src/graph'
import { unlink } from './src/lib'

const DIRS: [string, Kind][] = [['projects', 'project'], ['tasks', 'task'], ['inbox', 'thought'], ['notes', 'thought'], ['meetings', 'meeting']]
const WALK_DAYS = 7
const wikilinks = (text: string) => [...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim())
// Frontmatter typed by hand as `related: [[X]]` (unquoted) parses as a list in a list: that's a link too.
const frontLinks = (v: unknown): string[] => (typeof v === 'string' ? wikilinks(v)
  : Array.isArray(v) ? v.flatMap((x) => (Array.isArray(x) && x.length === 1 && typeof x[0] === 'string' ? [x[0].trim()] : frontLinks(x)))
  : v && typeof v === 'object' ? Object.values(v).flatMap(frontLinks) : [])

export function knowledgeGraph(now = new Date()): KnowledgeGraph {
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
      contexts: context ? [String(context)] : [], status: String(d.data.status ?? ''), priority: String(d.data.priority ?? ''),
      ...(d.kind === 'project' && d.data.client === true ? { client: true } : {}),
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
      project: nodes.find((n) => n.id === from[0]?.id)?.project ?? '', contexts: [], status: '', priority: '',
    })
    for (const d of from) add(d.id, id, 'link')
  }

  // A learning folder is a lake; its MISSION.md names the work it fed, as a wikilink or a task id.
  const learning = path.join(VAULT, 'learning')
  const lakes = fs.existsSync(learning) ? fs.readdirSync(learning).filter((f) => fs.statSync(path.join(learning, f)).isDirectory()) : []
  for (const dir of lakes) {
    const mission = path.join(learning, dir, 'MISSION.md')
    const text = fs.existsSync(mission) ? readDoc(mission).body : ''
    const id = `learning/${dir}`
    nodes.push({
      id, kind: 'lake', name: dir, title: text.match(/^#\s+(?:Mission:\s*)?(.+)$/m)?.[1].replace(/^Mission$/, '').trim() || dir.replace(/-/g, ' '),
      project: '', contexts: [], status: fs.existsSync(mission) ? 'mission' : '', priority: '',
    })
    for (const name of new Set([...wikilinks(text), ...(text.match(/\bT-\d{4}\b/g) ?? [])])) {
      const to = byName.get(name)
      if (to) add(id, to, 'stream')
    }
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
  return { nodes, edges: [...edges.values()], walk: walkSteps(docs, byId, now) }
}

// Where you went in the last days, in time order (local time): sessions on their task, meetings with a
// time, thoughts by the time in their file name.
function walkSteps(docs: { id: string; kind: Kind; name: string; data: Record<string, any> }[], byId: Map<string, GraphNode>, now: Date): WalkStep[] {
  const since = new Date(now.getTime() - WALK_DAYS * 864e5).toLocaleDateString('sv')
  const local = (d: Date) => `${d.toLocaleDateString('sv')}T${d.toTimeString().slice(0, 5)}`
  const steps: WalkStep[] = []
  for (const s of listDocs('sessions')) {
    const started = new Date(String(s.data.started ?? ''))
    const id = `tasks/${unlink(s.data.task)}.md`
    if (!Number.isNaN(started.getTime()) && byId.has(id)) steps.push({ at: local(started), id, what: 'session' })
  }
  for (const d of docs) {
    const [date, time] = [String(d.data.date ?? ''), String(d.data.time ?? '')]
    if (d.kind === 'meeting' && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{1,2}:\d{2}$/.test(time)) steps.push({ at: `${date}T${time.padStart(5, '0')}`, id: d.id, what: 'meeting' })
    const stamp = d.kind === 'thought' && d.id.startsWith('inbox/') ? /^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2})/.exec(d.name) : null
    if (stamp) steps.push({ at: `${stamp[1]}T${stamp[2]}:${stamp[3]}`, id: d.id, what: 'thought' })
  }
  const end = local(now)
  return steps.filter((s) => s.at.slice(0, 10) >= since && s.at <= end).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}
