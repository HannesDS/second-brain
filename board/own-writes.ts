// Files the board wrote itself, remembered by modification time with the tab that wrote them, so the file
// watcher can tell that tab's own echo from a change made elsewhere (Obsidian, an agent, another tab).
// A later write elsewhere changes the time.
import fs from 'node:fs'

export function ownWrites() {
  const seen = new Map<string, { mtime: number; tab: string }>()
  const mtime = (file: string) => { try { return fs.statSync(file).mtimeMs } catch { return undefined } }
  return {
    mark(file: string, tab: string) { seen.set(file, { mtime: mtime(file) ?? -1, tab }) },
    // The tab that wrote the file, or undefined when it changed elsewhere.
    writer(file: string) {
      const own = seen.get(file)
      if (own && own.mtime === mtime(file)) return own.tab
      seen.delete(file)
    },
  }
}
