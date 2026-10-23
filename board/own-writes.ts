// Files the board wrote itself, remembered by modification time with the tab that wrote them, so the file
// watcher can tell that tab's own echo from a change made elsewhere (Obsidian, an agent, another tab).
// A later write elsewhere changes the time. A write elsewhere (another tab too) just before, within
// RECENT_MS, would echo together with the board's, so then the board's write isn't claimed and the tab
// reloads. The watcher echoes within a moment, so after FORGET_MS a file is forgotten, which keeps the
// list short on a long-running server.
import fs from 'node:fs'

const FORGET_MS = 60_000
const RECENT_MS = 2000

export function ownWrites() {
  const seen = new Map<string, { mtime: number; tab: string; at: number }>()
  const mtime = (file: string) => { try { return fs.statSync(file).mtimeMs } catch { return undefined } }
  return {
    // Runs the board's `write` of `file` for `tab`, and remembers it as that tab's own.
    write<T>(file: string, tab: string | undefined, write: () => T): T {
      const before = mtime(file)
      const own = seen.get(file)
      const out = write()
      const now = Date.now()
      for (const [f, w] of seen) if (now - w.at > FORGET_MS) seen.delete(f)
      const elsewhere = before !== undefined && (before !== own?.mtime || own.tab !== tab) && now - before < RECENT_MS
      if (tab && !elsewhere) seen.set(file, { mtime: mtime(file) ?? -1, tab, at: now })
      else seen.delete(file)
      return out
    },
    // The tab that wrote the file, or undefined when it changed elsewhere.
    writer(file: string) {
      const own = seen.get(file)
      if (own && own.mtime === mtime(file)) return own.tab
      seen.delete(file)
    },
  }
}
