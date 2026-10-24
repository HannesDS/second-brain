import { AudioLines, Bot, Brain, CalendarDays, GitPullRequest, NotebookText, Plug, RefreshCw, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Feeds } from './Calendar'
import { IconButton } from './ui'
import { ago, api } from './lib'

type Integration = { id: string; name: string; state: 'ok' | 'off' | 'error'; detail: string; lastRun: string; config: string[] }
const STATE = { ok: 'Works', off: 'Not set up', error: 'Error' }
// Lucide has no brand logos, so each service gets a glyph for what it does. A new one gets the plug until it has its own.
const ICON: Record<string, LucideIcon> = { notion: NotebookText, github: GitPullRequest, calendars: CalendarDays, claude: Bot, ollama: Brain, whisper: AudioLines }

// Every outside service the workbench uses: does it work, when did it last run, where is it set up.
export default function Integrations({ synced, fail }: { synced: (s: Record<string, string>) => void; fail: (e: Error) => void }) {
  const [list, setList] = useState<Integration[]>()
  const [syncing, setSyncing] = useState(false)
  const [feedsOpen, setFeedsOpen] = useState(false)
  const load = useCallback(() => api('integrations').then(setList, fail), [])
  useEffect(() => { load() }, [load])
  const sync = () => {
    setSyncing(true)
    api('sync', 'POST').then((s) => { synced(s); return load() }, fail).finally(() => setSyncing(false))
  }
  // One sync runs both Notion and GitHub.
  const syncButton = <IconButton icon={RefreshCw} label={syncing ? 'Syncing…' : 'Sync now'} showLabel disabled={syncing} onClick={sync} />
  const actions: Record<string, ReactNode> = {
    notion: syncButton,
    github: syncButton,
    calendars: <IconButton icon={CalendarDays} label="Calendars" showLabel onClick={() => setFeedsOpen(true)} />,
  }

  return (
    <main className="integrations">
      <div className="cal-head">
        <span className="muted">Notion and GitHub sync every 5 minutes while the board runs.</span>
        <div className="spacer" />
        <IconButton icon={RefreshCw} label="Check again" onClick={() => { setList(undefined); load() }} />
      </div>
      {!list && <p className="muted">Checking integrations…</p>}
      <div className="integration-list">
        {list?.map((i) => {
          const Icon = ICON[i.id] ?? Plug
          return (
            <article key={i.id} className={`integration ${i.state}`}>
              <div className="integration-top">
                <span className="integration-icon" aria-hidden><Icon size={18} strokeWidth={1.8} /></span>
                <h3>{i.name}</h3>
                <span className={`dot ${i.state}`} aria-hidden />
                <span className="integration-state">{STATE[i.state]}</span>
                <div className="spacer" />
                {actions[i.id]}
              </div>
              <p>{i.detail}</p>
              <p className="muted">Last run: <span className="time">{i.lastRun ? ago(i.lastRun) : 'never'}</span></p>
              <ul className="integration-config" aria-label="Configured in">
                {i.config.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </article>
          )
        })}
      </div>
      {feedsOpen && <Feeds close={() => { setFeedsOpen(false); load() }} fail={fail} />}
    </main>
  )
}
