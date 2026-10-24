// The map's symbols, shared by Brain Terrain and Thoughts. Coloured by the --map-* tokens, which pass into
// each <use>: a light ground (Thoughts' lists and cards) re-points them with .sym. The only copy: docs/MAP-STYLE.md points here.

// On a 12x12 grid, hairline.
export function Symbols() {
  return <>
    <symbol id="s-todo" viewBox="0 0 12 12"><circle className="bt-s ground note" cx="6" cy="6" r="3" strokeWidth="1.1" /></symbol>
    <symbol id="s-wip" viewBox="0 0 12 12"><circle className="bt-s wood-fill ground-line" cx="6" cy="6" r="3.6" strokeWidth="1" /></symbol>
    <symbol id="s-review" viewBox="0 0 12 12"><path className="bt-s water" d="M3.4 1.8c2.1 2.2 2.1 6.2 0 8.4M8.6 1.8c-2.1 2.2-2.1 6.2 0 8.4" fill="none" strokeWidth="1.3" /></symbol>
    <symbol id="s-blocked" viewBox="0 0 12 12"><path className="bt-s trail" d="M3 3l6 6M9 3 3 9" strokeWidth="1.6" /></symbol>
    <symbol id="s-done" viewBox="0 0 12 12"><path className="bt-s ink" d="M6 1.2v8.2M3.4 3.8h5.2M3.6 10.8h4.8" strokeWidth="1.2" /></symbol>
    <symbol id="s-tree" viewBox="0 0 12 12"><circle className="bt-s ground wood" cx="6" cy="4.8" r="2.9" strokeWidth="1.1" /><path className="bt-s wood" d="M6 7.7v3.3" strokeWidth="1.1" /></symbol>
    <symbol id="s-sapling" viewBox="0 0 12 12"><path className="bt-s faint" d="M6 10.6V5.2M6 7 3.9 5M6 6 8.1 4" fill="none" strokeWidth="1" /></symbol>
    <symbol id="s-hut" viewBox="0 0 12 12"><path className="bt-s ink" d="M1.6 6.2 6 2.4l4.4 3.8" fill="none" strokeWidth="1.2" /><rect className="bt-s ink-fill" x="3" y="6" width="6" height="4.4" /></symbol>
    <symbol id="s-view" viewBox="0 0 12 12"><path className="bt-s water-ink" d="M6 10 2 4.6M6 10 4.2 3M6 10V2.6M6 10 7.8 3M6 10l4-5.4" strokeWidth=".9" /><circle className="bt-s water-ink-fill" cx="6" cy="10" r="1.3" /></symbol>
    <symbol id="s-lake" viewBox="0 0 12 12"><path className="bt-lake" d="M1.4 6.4C1.6 3.4 5 2.6 7.8 3s3.4 2.4 2.6 4.2-4.2 2.4-6.4 2S1.3 7.6 1.4 6.4Z" /><path className="bt-s water" d="M3.6 5.6c1.6-.8 3.4-.8 5 0" fill="none" strokeWidth=".6" /></symbol>
    <symbol id="s-peak" viewBox="0 0 12 12"><path className="bt-s ink-fill" d="M6 2.5 10.2 9.8H1.8Z" /></symbol>
    <symbol id="s-peak-hot" viewBox="0 0 12 12"><path className="bt-s walk-fill" d="M6 2.5 10.2 9.8H1.8Z" /></symbol>
    <symbol id="s-agent" viewBox="0 0 12 12"><rect className="bt-s water-fill" x="3" y="3" width="6" height="6" rx="1.2" /></symbol>
    <symbol id="s-start" viewBox="0 0 12 12"><circle className="bt-s ground walk" cx="6" cy="6" r="3.4" strokeWidth="1.6" /></symbol>
    <symbol id="s-here" viewBox="0 0 12 12"><circle className="bt-s walk-fill ground-line" cx="6" cy="6" r="3.6" strokeWidth="1.4" /></symbol>
  </>
}

// Rendered once by the app, so every view can <use> them.
export const SymbolDefs = () => <svg className="sym-defs" aria-hidden><defs><Symbols /></defs></svg>

// One symbol inline with text, on a light ground. `newest`: the highlighted sapling of the newest thought.
export const MapSymbol = ({ id, newest }: { id: string; newest?: boolean }) => (
  <svg className={`sym ${newest ? 'newest' : ''}`} viewBox="0 0 12 12" aria-hidden><use href={`#s-${id}`} width="12" height="12" /></svg>
)
