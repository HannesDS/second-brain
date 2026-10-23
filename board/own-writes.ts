// Files the board wrote itself, remembered by modification time with the tab that wrote them, so the file
// watcher can tell that tab's own echo from a change made elsewhere (Obsidian, an agent, another tab).
// A later write elsewhere changes the time. The watcher echoes within a moment, so after FORGET_MS a file
// is forgotten, which keeps the list short on a long-running server.
import fs from 'node:fs'

const FORGET_MS = 60_000

export function ownWrites() {
  const seen = new Map<string, { mtime: number; tab: string; at: number }>()
  const mtime = (file: string) => { try { return fs.statSync(file).mtimeMs } catch { return undefined } }
  return {
    mark(file: string, tab: string) {
      const now = Date.now()
      for (const [f, w] of seen) if (now - w.at > FORGET_MS) seen.delete(f)
      seen.set(file, { mtime: mtime(file) ?? -1, tab, at: now })
    },
    // The tab that wrote the file, or undefined when it changed elsewhere.
    writer(file: string) {
      const own = seen.get(file)
      if (own && own.mtime === mtime(file)) return own.tab
      seen.delete(file)
    },
  }
}
