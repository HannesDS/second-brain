---
name: grill
description: Interview the user about a task before building it. One question at a time, challenge assumptions, then write the outcome into the task body under "Decisions". Use when the user says /grill, "grill me", or before starting a build on a task.
---

# Grill

Goal: reach a shared understanding of the task before any code is written.

1. Find the task: `$TASK_ID`, an id the user gave, or ask. Read `~/Projects/second-brain/vault/tasks/<id>.md`, its project file, linked meetings and sources. If the task has a repo, look at the relevant code first. Never ask the user a fact you can look up.
2. List the open decisions for yourself: scope, behaviour, edge cases, data, UX, testing, what is out of scope. Order them so each question only depends on answers you already have.
3. Ask **one question at a time**. For each: the question, the options with trade-offs, and your recommended answer, worded so "yes" accepts it. Challenge assumptions that look shaky; propose a smaller version when the task looks too big.
4. Wait for the answer. Recompute what is still open. Repeat until nothing is left.
5. Confirm the summary with the user, then write it into the task body under `## Decisions` (append; date the block):

```markdown
## Decisions

### YYYY-MM-DD
- <decision>: <choice> (why, one clause)
- Out of scope: ...
```

Also update `## Acceptance criteria` if the grilling changed it, and set `updated` to today. Do not start building until the user says so.

## Finding related notes

Search the whole vault by meaning (local embeddings): `node ~/Projects/second-brain/scripts/vault-search.mjs "<question>"`. Use it before asking the user something the vault may already answer.
