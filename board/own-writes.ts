// Files the board wrote itself, remembered by modification time, so the file watcher can tell its own
// echo from a change made elsewhere (Obsidian, an agent). A later write elsewhere changes the time.
import fs from 'node:fs'

export function ownWrites() {
  const seen = new Map<string, number>()
  const mtime = (file: string) => { try { return fs.statSync(file).mtimeMs } catch { return undefined } }
  return {
    mark(file: string) { seen.set(file, mtime(file) ?? -1) },
    isOwn(file: string) {
      const own = seen.has(file) && seen.get(file) === mtime(file)
      if (!own) seen.delete(file)
      return own
    },
  }
}
