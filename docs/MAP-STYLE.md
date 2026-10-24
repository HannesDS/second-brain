# Brain Terrain: map style

The Brain Terrain view draws the vault as a survey map. It uses the Terrain design system (docs/DESIGN.md), Moss theme.
Code: `board/src/BrainTerrain.tsx` (drawing), `board/src/graph.ts` (layout, walk), `board/graph.ts` (data); colours are the `--map-*` tokens in `terrain.css`.
Reference designs: https://claude.ai/artifact/EJY3WZnjtQmD6x9e9yDWfk (map sheet, key, today's walk). Symbols: `Symbols()` in `board/src/symbols.tsx`, the only copy; the app renders them once (`SymbolDefs`) and Thoughts uses them too (`MapSymbol` on light grounds).

Rule of thumb: hairline symbols in one ink, colour only where it means something. No fills, shadows or illustrations beyond this list.

## What is what

| Vault | On the map | Symbol / style |
|---|---|---|
| Context (Data Minded, Personal) | Region | Dash-dot border `12 4 2 4`, wide light capitals at 16% opacity |
| Client project (`client: true` in the project file, e.g. Umicore) | Enclave | Dotted ring `1.5 3.5` |
| Project | Hill | Contours, one per open task, every third an index contour. Tints `#1C2820` → `#384E3F` |
| Project with p0/p1 open | Ochre summit | `peak-hot` |
| Task: to do | Waypoint | `todo` |
| Task: in progress | Camp | `wip` |
| Task: review | Pass (col) | `review` |
| Task: blocked | Route closed | `blocked` |
| Task: done | Summit cross | `done` |
| Thought, filed | Tree, many on one hill become a wood | `tree`, `wood` pattern |
| Thought, unfiled (inbox) | Sapling in The Clearing | `sapling` |
| Meeting | Hut | `hut` |
| Teach report | Viewpoint | `viewpoint` |
| Learning folder | Lake, stream to the work it fed | glacier `#7FB7C9` at 18% fill, 1px edge |
| Wikilink | Marked trail | `#E07A5F` 1.2px, dash `6 4` |
| Similar content | Faint path | `#8D9B8F` 1px, dash `1 4` |
| Agent working | Cable line | glacier dashed line + `agent`; waiting = pulsing ring |
| Today's sessions, thoughts, meetings in time order | The walk | ochre `#E3A44A` 2.4px on a 6px `#161F19` casing, times in DM Mono |
| Earlier days | Old tracks | ochre 1.2px, dash `1 5`, 55% opacity |
| A jump between hills in the walk | Traverse | just a long leg; label it "context switch" |

## Contours

`stroke #3E5245 0.7px`, index `#58705F 1.1px`, `vector-effect: non-scaling-stroke`. Hillshade: the outer shape, offset (+16, +20), `#0E140F` at 70%, blur 14.

## Lettering

- Hills: Bricolage Grotesque 700, capitals, letter-spacing .22em, `#EEF0E8`, size by height (10 to 18px).
- Numbers, times, notes: DM Mono 10.5px `#A9B8A6`, times in ochre.
- Water: DM Mono italic, `#8CC3D4`.
- Every label gets a 4px `#161F19` halo (`paint-order: stroke`).

## Walk data

Sessions (`sessions/*.md`: `started`, `task`), inbox thoughts (time in the file name) and meetings of the day, sorted by time.
Each point sits on its task's hill. Today's planted trees go where the walk was at that moment.

## Motion

The walk draws itself once on load (4s). Only waiting agents and "you are here" pulse. Nothing else loops.
