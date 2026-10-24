// Markdown-with-frontmatter helpers shared by the board and the session hook.
import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from 'yaml'

export const ROOT = path.resolve(import.meta.dirname, '..')
// SECOND_BRAIN_VAULT points tests (and the hook they run) at a scratch vault.
export const VAULT = process.env.SECOND_BRAIN_VAULT ?? path.join(ROOT, 'vault')
export const ID = /^[\w.-]+$/

export const today = () => new Date().toLocaleDateString('sv') // YYYY-MM-DD, local time

export function readDoc(file) {
  const text = fs.readFileSync(file, 'utf8')
  // The closing --- must be a line of its own: a value like "a---b" doesn't end the frontmatter.
  const m = text.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
  if (!m) return { data: {}, body: text }
  try {
    const data = parse(m[1] ?? '') ?? {}
    return { data: typeof data === 'object' ? data : {}, body: m[2] }
  } catch (e) {
    // Broken YAML (half-typed in Obsidian): show it, but never write over it.
    return { data: {}, body: m[2], error: e.message }
  }
}

export function writeDoc(file, data, body = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `---\n${stringify(data, { lineWidth: 0 })}---\n${body}`)
}

// Merges patch into the existing frontmatter so fields added by hand survive.
// Stamps `completed` when a task becomes done, so the board can list the latest done first.
// Returns the frontmatter as it was before.
export function updateDoc(file, patch, body) {
  const doc = readDoc(file)
  if (doc.error) throw new Error(`${path.basename(file)} has invalid frontmatter: ${doc.error}`)
  const becameDone = path.basename(path.dirname(file)) === 'tasks' && patch.status === 'done' && doc.data.status !== 'done'
  const completed = becameDone ? { completed: today() } : {}
  writeDoc(file, { ...doc.data, ...patch, ...completed, updated: today() }, body ?? doc.body)
  return doc.data
}

export function listDocs(dir) {
  const full = path.join(VAULT, dir)
  if (!fs.existsSync(full)) return []
  return fs.readdirSync(full)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f.slice(0, -3), ...readDoc(path.join(full, f)) }))
}

export function nextTaskId() {
  const nums = listDocs('tasks').map((d) => Number(/^T-(\d+)$/.exec(d.name)?.[1] ?? 0))
  return `T-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`
}
