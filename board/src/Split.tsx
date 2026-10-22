import { Children, type ReactNode } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'

// localStorage can throw (private mode); then the layout just isn't remembered.
const storage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* not persisted */ } },
}

// Two panes with a draggable divider; the chat side can be collapsed by dragging it closed. Sizes are remembered per page.
export default function Split({ id, children, sideLeft }: { id: string; children: ReactNode; sideLeft?: boolean }) {
  const [main, side] = Children.toArray(children)
  const sidePanel = <Panel id="side" minSize="18%" defaultSize="35%" collapsible collapsedSize="0%">{side}</Panel>
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id, storage, onlySaveAfterUserInteractions: true })
  return (
    <main className="split">
      <Group defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} resizeTargetMinimumSize={{ coarse: 40, fine: 12 }}>
        {sideLeft && <>{sidePanel}<Separator className="split-handle" /></>}
        <Panel id="main" minSize="30%" defaultSize="65%">{main}</Panel>
        {!sideLeft && <><Separator className="split-handle" />{sidePanel}</>}
      </Group>
    </main>
  )
}
