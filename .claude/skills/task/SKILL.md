---
name: task
description: Create, update, move or link tasks in the second-brain vault from chat. Use when the user says things like "add a task for X in portal, p1", "move T-0042 to review", "link this PR to the task", "what's on my plate", or mentions a task id like T-0042.
---

# Task

The vault lives at `~/Projects/second-brain/vault`. Files are the database; the board and Obsidian read the same files, so edit them directly.

## Files

- Tasks: `vault/tasks/T-NNNN.md`. Projects: `vault/projects/<id>.md`. Meetings: `vault/meetings/<date> <title>.md`.
- New task id: highest existing `T-` number + 1, zero-padded to 4 digits.

## Task frontmatter

```yaml
id: T-0042
title: Add lineage view to output ports
aliases: [Add lineage view to output ports]   # always equal to title
project: "[[portal]]"                         # project file name, as wikilink
status: todo        # todo | wip | review | blocked | done
priority: p2        # p0 | p1 | p2 | p3 (default p2)
order: 0            # position in column; new tasks: max order in column + 1
type: code          # code | pr-review | meeting | research | admin
blocked_by: ""      # free text or "[[T-0040]]"
repo: ""
branch: ""
pr: ""
sessions: []
meetings: []        # ["[[2026-10-20 portal sync]]"]
sources: []         # urls, Slack threads, docs
due: ""             # YYYY-MM-DD
created: YYYY-MM-DD
updated: YYYY-MM-DD
```

Body: description, `## Acceptance criteria`, notes. Later skills add `## Decisions` and `## Reports`.

## Rules

- Resolve the project from the user's words against `vault/projects/*.md` (`id` or `name`). If ambiguous, ask.
- On every edit set `updated` to today. Keep fields you don't touch, including unknown ones.
- Moving to `done`: also set `completed` to today.
- Moving to `blocked`: ask for the reason if not given and put it in `blocked_by`.
- Linking a meeting: add `"[[<meeting>]]"` to the task's `meetings` and `"[[T-NNNN]]"` to the meeting's `tasks`.
- After a change, reply with one line: id, title, status, priority.
- Listing: read the task files, group by status, sort by priority then `order`.

## Projects

- "Make a project for X": create `vault/projects/<id>.md` with `id`, `name`, `context` (dataminded | personal; clients are Data Minded projects), `account` (dm | personal), `repos: []`, `status: active`. Ask for context and account if they're not obvious. Work and client projects → `dm`; my own company and side projects → `personal`.

## Notion

- A task can carry `notion: <page url>` (the team's ticket). The workbench pushes status changes to it. Don't edit Notion yourself for status; just change `status` in the file.

## Finding related notes

Search the whole vault by meaning (local embeddings): `node ~/Projects/second-brain/scripts/vault-search.mjs "<question>"`. Use it before asking the user something the vault may already answer.
