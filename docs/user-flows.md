# User flows and UX findings

A walk through the workbench as Hannes, on 2026-10-22, at desktop size (1440×900). For each flow: what I'd expect, what happened, and what changes.

## How the information is organised (target)

```
Context      All · Data Minded · Personal          (top right, filters everything)
└─ Project   one project, or all                    (side menu; shown in the breadcrumb)
   └─ View   My day · Thoughts · Calendar · Board · Timeline · Agents
      └─ Item  task · thought · meeting · agent         (opens in the side peek, never leaves the page)
```

* **The side menu chooses where you are**: a view, and optionally a project. The selected view and project are highlighted.
* **The top bar says where you are**: `Board › Data Product Portal`. The project chip has an ✕ to go back to all projects, and opens the project overview (its tasks, chat, agents) in the peek.
* **Items open in the side peek**: you keep your place. The peek closes when you switch view or project.
* **The same words everywhere**: To do, In progress, Review, Blocked, Done. Not "WIP" on one page and "Now" on another.

## Flows

| # | Flow | Before | After |
|---|---|---|---|
| 1 | **Morning: what needs me?** Open My day. | Agents waiting, meetings, then a Next/Now/Waiting mini board that can't be dragged and uses other words than the Board. | Same sections; the board on My day is the real Board (same columns, same names), drag between columns, up to 6 cards per column plus "N more". |
| 2 | **Start working on a task.** Drag from To do to In progress, open it, start an agent. | Dragging only on the Board page. | Drag on My day or the Board; ▶ on the card, or Start agent in the task page. |
| 3 | **Where am I?** Look at the top. | Only the context switch. No page name; Board's title was a small heading inside the page. | Breadcrumb in the top bar: view icon + name, and the project when one is selected. |
| 4 | **Board for one project.** | Not possible: no project filter. Clicking a project in the menu opened a peek, but the Board stayed unfiltered. | Click the project in the menu: every view is scoped to it (My day, Board, Timeline, the tasks and meeting notes on the Calendar, Agents). Thoughts stays unscoped: it's the capture inbox. ✕ in the breadcrumb clears it. |
| 5 | **Look at a project as a whole** (tasks, chat, new agent). | Peek from the menu. | "Overview" next to the project in the breadcrumb, or a project name on any card: opens the peek. |
| 6 | **Capture a thought.** + Thought or ⌘⇧K from anywhere, type, ⌘↵. | Works. | Saved as-is, then the agent proposes project, links and tasks right away; it asks when unsure. |
| 7 | **Prepare a meeting.** Calendar → click meeting → prep todo / notes. | Calendar looked empty for about 4.5 s with no loading state; My day and Calendar evicted each other's cache, so every switch refetched all feeds. | Feeds cached per calendar (not per date range) and loaded when the server starts; "Loading…" while fetching. |
| 8 | **Answer an agent.** My day → agent row → terminal in the peek. | Works; the folder line was shown twice. Peek stayed open after switching pages and covered the new page. | One folder line. The peek closes when you switch view or project. |
| 9 | **Find something.** Search box. | Works; opens in the peek. | Unchanged. |
| 10 | **Plan the week.** Timeline. | Works, but not filterable by project. | Follows the project scope. |
| 11 | **Find a meeting note.** Thoughts → Meetings. | Sorted oldest first (July at the top), because the import gave every file the same time. | Newest first, by the date in the name. |
| 12 | **Projects overview.** | A separate menu item next to the views, mixed in with them. | The "Projects" header in the menu opens the cards; views and projects are separate groups. Guide moves to the menu footer. |

## Smaller things noticed

* Board cards repeat the task id next to a truncated project name: the project gets the space, the id goes small.
* Project cards show the context twice (DM badge and a "dataminded" chip). Left as is for now: the badge is the brand colour the other session added.
* A new task (+ Task) opens empty as "Untitled"; with a project selected it now lands in that project.

## Checked after the changes (2026-10-22)

* My day: breadcrumb shows "My day"; dragging a card from To do to In progress saves `status: wip` to the file.
* Selecting Umicore in the menu: My day and Board show only Umicore; the breadcrumb reads "Board › Umicore"; ✕ goes back to all projects.
* Project overview from the breadcrumb opens the peek; switching view closes it.
* Calendar: events show at once on the second visit (feeds cached per calendar, warmed when the server starts).
* Thoughts: newest meeting notes first.
