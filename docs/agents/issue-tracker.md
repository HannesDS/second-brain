# Issue tracker: the second-brain vault

Issues are tasks in the vault: one markdown file per task at `~/Projects/second-brain/vault/tasks/T-NNNN.md`. The board and Obsidian read the same files. The `task` skill holds the full file format; follow it.

## Conventions

- New id: highest existing `T-` number + 1, zero-padded to 4 digits. Create tickets one at a time, blockers first, so each one can name the ids it depends on.
- `project:` is the project's file name as a wikilink: `"[[workbench]]"` for this repo. Projects live in `vault/projects/`.
- The ticket body is markdown: the "What to build" text, then `## Acceptance criteria` as a checklist. A parent ticket, if any, goes on a `Parent: [[T-NNNN]]` line at the top of the body.
- **Blocking**: `blocked_by: "[[T-0080]], [[T-0081]]"`. A ticket is unblocked when every task it lists has `status: done`. Never set `status: blocked` just because a ticket has blockers: that status means "stuck, needs me".
- Triage state is the task's `status` (see `triage-labels.md`).
- Comments and conversation history append to the bottom of the body under `## Comments`.
- Set `updated:` to today on every edit; keep fields you don't touch.
- When you set `status: done`, also set `completed:` to today (the board lists the latest done first).

## When a skill says "publish to the issue tracker"

Write a new task file as above. For tickets that are agent-grabbable, use `status: ready`: the workbench's autopilot picks up ready tickets whose blockers are done, most urgent first, a few at a time, each in its own worktree. Use `status: todo` for anything I should look at first.

## When a skill says "fetch the relevant ticket"

Read `vault/tasks/<id>.md`. I normally pass the id (`T-0042`).

## Wayfinding operations

Used by `/wayfinder`.

- **Map**: a task with `type: research` whose body holds the Destination / Notes / Decisions-so-far / Fog sections.
- **Child ticket**: a task with `Parent: [[<map id>]]` on the first body line and the question in the body. Its `type` is `research` (also for prototype and grilling tickets) or `code` (for a task). Claimed = `status: wip`, resolved = `status: done`.
- **Blocking**: `blocked_by` as above.
- **Frontier**: tasks whose body names the map as Parent, not `done` or `wip`, with every blocker `done`; lowest id wins.
- **Claim**: set `status: wip` and save before any work.
- **Resolve**: append the answer under `## Answer`, set `status: done`, then add a gist + `[[T-NNNN]]` link to the map's Decisions-so-far.
