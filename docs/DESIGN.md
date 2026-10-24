# Design system: Terrain

The workbench has themes. **Terrain** is the default. **Classic** is the old Primer-like look, kept as a fallback.
Switch with the mountain button in the top bar. The choice is stored in `localStorage` as `sb.theme`.

- Tokens and the Classic look: `board/src/styles.css`
- The Terrain theme: `board/src/terrain.css` (everything scoped to `<html data-theme="terrain">`)
- Theme and mode hooks: `board/src/theme.ts`, used in `App.tsx`; the mode switch is `ModeSwitch` in `board/src/ui.tsx`
- Signature view: the trail, `board/src/Trail.tsx` and `board/src/Cairns.tsx` on My day (logic in `board/src/day.ts`)
- Fonts: `board/public/fonts/` (Bricolage Grotesque, DM Mono, both OFL; local, no CDN)
- Browsable reference with tokens and component previews: https://claude.ai/artifact/8v6GL9j3nCizf2V8orR9Li

## Idea

Each project is a hill. The more open work, the higher it rises. Your day is a trail between meetings.
Calm, organic, grounded. You read the landscape in one glance, then go to the work.

Three rules carry the whole look:

1. **Contours, not boxes.** Lines are soft and rounded. Separators can be dashed, like contour lines.
2. **One warm highlight.** Ochre means "now" or "important". It's the only loud colour.
3. **Spring, not flash.** Things settle in with a little overshoot. Only agents loop: waiting ones, and running ones in the dependency view.

## Palette

| Name | Hex | Role |
|---|---|---|
| Moss | `#1E2A22` | Text, primary buttons. The dark ground in dark mode. |
| Fog | `#EEF0E8` | Page ground in light mode. |
| Lichen | `#B8D4A0` | In progress (fill). Ink version `#3F6B2E` for text and icons. |
| Ochre | `#E3A44A` | Highlight: today, focus, p1, peaks. Ink version `#8A5A12` for text on light. |
| Glacier | `#7FB7C9` | Review, agents waiting. Ink version `#2F6577`. |
| Clay | `#C4553B` | Blocked, p0. Text version `#B2432B`. |

Never put white text on ochre, lichen or glacier: use Moss (`--on-fill`). White on Clay is fine.

## Tokens

Components only use tokens, never raw hex. The role names are shared with Classic, so a component
styled with them works in every theme.

- Surfaces: `--bg`, `--surface`, `--surface-2`, `--border`, `--contour`, `--contour-strong` (dashed lines, open stretches, empty pips), `--card-edge` (card border)
- Text: `--text`, `--muted`
- Action: `--accent`, `--accent-text`, `--focus`, `--highlight`, `--highlight-soft`, `--on-fill` (text on ochre, lichen, glacier), `--toggle-on` (selected segment)
- Priority: `--p0` to `--p3`
- Status fills: `--st-todo`, `--st-wip`, `--st-review`, `--st-blocked`, `--st-done`, plus `--st-wip-ink`, `--st-review-ink` for text
- Context: `--ctx-dm`, `--ctx-personal`
- Map (Brain Terrain only): `--map-*`, the survey palette in docs/MAP-STYLE.md. Terrain sets them on `.bt-page`, Moss in light and dark mode.
- Shape: one radius scale, and every `border-radius` uses it (no px, % or em in rules): `--radius-sm` (8: chips, tags, small controls), `--radius` (14: buttons, inputs, cards), `--radius-md` (18: board cards), `--radius-lg` (22: columns, big cards), `--radius-xl` (28: dialogs, peek edge), `--radius-pill`, `--radius-round` (dots), `--radius-pebble` (primary buttons, slightly uneven). Classic sets the same names smaller (4, 6, 8, 12, 12)
- Depth: `--shadow`, `--shadow-lift` (hover, selected), `--shadow-float` (peek, drawer)
- Type: `--font-ui` (Bricolage Grotesque), `--font-mono` (DM Mono)
- Motion: `--spring` `cubic-bezier(.34,1.56,.64,1)`, `--ease` `cubic-bezier(.4,0,.2,1)`

Dark mode ("Moss") swaps the same tokens; see Mode.

## Mode

Mode is separate from the theme: every theme has a light and a dark version.

- Choices: Light, Dark, Match system. **Default Light**, also on a Mac in dark mode. Stored in `localStorage` as `sb.mode`.
- The resolved mode sits on `<html data-mode="light|dark">`. `index.html` sets it before the app paints, so there is no flash.
  Match system follows the OS live (`useMode` listens to `prefers-color-scheme`).
- CSS: dark token blocks are `:root[data-mode="dark"]` (Terrain: `:root[data-theme="terrain"][data-mode="dark"]`), dark component rules
  `[data-mode="dark"] .x` (Terrain: `[data-theme="terrain"][data-mode="dark"] .x`). Never a `prefers-color-scheme` media query. Each mode sets `color-scheme`, so scrollbars and native inputs follow.
- Libraries that take colours in JS (xyflow, xterm) follow `useDark()`, not the media query.
- The switch: a segmented pill top right in the top bar, before the theme button. Sun, Moon, Monitor.
  Track `--surface-2` with a `--border` edge, 32px round buttons, the selected one on `--toggle-on`. It is a radio group: Tab lands on the choice, arrows move it.

| Token | Fog (light) | Moss (dark) |
|---|---|---|
| `--bg` | `#EEF0E8` | `#111814` |
| `--surface` | `#FFFFFF` | `#1F2B24` |
| `--surface-2` | `#F6F7F2` | `#273630` |
| `--border` | `#D5DCCB` | `#3E5245` |
| `--muted` | `#4A5A4E` | `#AEBDAB` |
| `--contour-strong` | `#B9C4AC` | `#566B5C` |
| `--card-edge` | transparent | `#3E5245` (no shadow in dark, so cards get an edge) |
| `--on-fill` | `#1E2A22` | `#1E2A22` |
| `--toggle-on` | `#FFFFFF` | `#3A4C40` |

Moss surface on ground is 1.23:1 plus the card edge. Text on surface / surface-2: 12.8 / 11.0, muted 7.5 / 6.4, ochre 6.8 / 5.8.

## Type

- **Bricolage Grotesque** for everything you read. Optical sizing is on, so big text gets tighter by itself.
  - Page date on My day: 40 / 800 / -0.035em
  - Page and task titles: 21 to 34 / 800 / -0.03em
  - Card titles: 15 / 650
  - Body: 15 / 400
- **DM Mono** for things you scan: ids, times, counts, section labels (11px, uppercase, 0.08em tracking).

## Status: elevation markers

| Status | Marker | Colour |
|---|---|---|
| To do | Base camp (dot) | muted |
| In progress | Climbing (triangle) | lichen ink |
| Review | On the ridge | glacier ink |
| Blocked | Rockfall | clay |
| Done | Summit | text |

Use the same words everywhere: To do, In progress, Review, Blocked, Done.

## Priority

Pills in DM Mono. p0 clay with white text, p1 ochre with moss text, p2 quiet fill, p3 outline only.

## Components

| Component | Class | Terrain look |
|---|---|---|
| Primary button | `button.primary`, `.ib.primary` | Moss, pebble radius (slightly uneven), spring scale on hover |
| Secondary button | `button`, `.ib.with-label` | Surface with border, radius 14 |
| Icon button | `.ib` | 32px, radius 10, no border |
| Segmented control | `.segmented` | Pill track, selected item lifts |
| Search | `.search input` | Pill, ochre focus halo |
| Card | `.card`, `.mini-card`, `.todo-list li` | Radius 18, lift shadow on hover. **No transform**, dnd-kit owns it |
| Highlighted card | `.focus`, `.big` | Soft ochre field and ochre border. No left-border stripe |
| Column | `.column` | Surface-2, radius 22, marker in the header |
| Project card | `.project-card` | Contour rings in the corner, lifts 3px |
| Agent row | `.agent` | Status dot on the left. Waiting = glacier ring that breathes |
| Peek and drawer | `.peek`, `.drawer` | Rounded left edge (28), slides in with a spring |
| Toast | `.toast` | Moss pill, pops in |

## Signature view: the trail

`Trail.tsx` on My day, in every theme. The day as a line from 08:00 to 18:00 (wider when a meeting falls outside).

- Meetings: fixed pills on the line, positioned by time. Click opens or starts the meeting note
- Open stretches: gaps of 30 minutes or more, dashed cards under the line. Click opens "Choose your way": a kind of work
  (Deep, Light, Rest), then a task in progress or review, one that is due soon, or a project as a ring chip
- A chosen stretch shows the task with its status marker. The stretch you are in now gets the ochre field
- Now: an ochre line with "Now HH:MM". Before it the line is solid (walked), after it dashed
- Terrain draws the line as a path that winds a few pixels, over faint contour lines and two low hills in the card; Classic keeps it straight
- Cairns on the line: at a time with a label above, or a small lichen marker right after each meeting
- Stored in `vault/days/YYYY-MM-DD.md` frontmatter: `ways` (by stretch start) and `cairns` (done or a count)

### Cairns

`Cairns.tsx`. Small habits that come back on a schedule, one file each in `vault/cairns/<slug>.md`.

- One card per cairn due today: icon, name, schedule, detail, glacier pips for counts, seven week dots
  (done lichen, missed outline, today ring, future dashed), one action (Start, +1, Mark done). Done cards go quiet on surface-2
- Breathe: the timer draws three contour rings that grow and shrink (in 4, hold 4, out 4, hold 4). Reduced motion keeps them still
- A meeting ending pops a toast for "after each meeting" cairns; a cairn with `nudge: true` also sends a browser notification

## Brain Terrain: the vault as a map

`BrainTerrain.tsx`, its own page. The whole vault drawn like a contour map, so you find things by place.

- Hills: one per project, sized by its docs, drawn with the landscape's rings. An ochre peak means urgent or high work
- Places on a hill, by elevation: in progress, review and blocked near the summit, to do halfway, done at the foot. Thoughts, meetings and reports sit in the foothills
- Lowlands: docs outside a project settle next to what they link to. Docs linked to nothing go to the dashed "Uncharted" strip
- Trails: dashed curves for links, faint dotted ones for docs that read alike. Pointing at or picking a place lights its trails in ochre and fades the rest
- Names: hills are always named (caps, wide tracking). Places get their name from zoom 1.3, or when you point at them or a trail leads there
- Navigation: drag to pan, wheel to zoom, "Find a place" flies to a result. The card shows what you picked, Open, and the trails from there
- Follows the context switch; the project filter flies to that hill. Layout: `mapOf` in `graph.ts`, deterministic, so the map doesn't move between visits

## Motion

| Name | Where | Spec |
|---|---|---|
| Settle | Every view on open | 0.45s, `--spring`, from 12px below |
| Spring | Buttons, project cards, hills | 0.35 to 0.5s, `--spring` |
| Peek | Side peek | 0.5s, `--spring`, from 48px right |
| Breathe | Waiting agents | 2s ring, infinite |
| Run | Dependency view: tickets an agent works on | 2s lichen ring on the status marker, infinite |

`prefers-reduced-motion` turns all of it off.

## Rules for Claude Code

1. Use tokens. No hex in components or in `styles.css` rules outside the token blocks.
2. Theme-specific CSS goes in the theme file, scoped with `[data-theme="terrain"]`. Never change Classic to get a Terrain effect.
3. A new component gets its base style in `styles.css` using tokens, so it works in both themes. Add Terrain extras in `terrain.css`.
4. No transform transitions on draggable things (`.card`, `.mini-card`). Use shadow and border.
5. No left-border colour stripes, no gradient washes, no emoji as icons. Icons are Lucide, stroke 1.8.
6. Text contrast 4.5:1 or better. Use the ink versions of lichen, glacier and ochre for text.
7. Mono only for ids, times, counts and labels. Never for sentences.
8. One loud thing per screen: the ochre highlight.

## Adding a theme

1. Add the name to `THEMES` and `THEME_LABEL` in `theme.ts`.
2. Create `board/src/<name>.css` with a `:root[data-theme="<name>"]` token block and a `:root[data-theme="<name>"][data-mode="dark"]` one, then scoped overrides.
3. Import it in `main.tsx` after `styles.css`.

Toybox is the next candidate.
