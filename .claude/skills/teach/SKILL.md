---
name: teach
description: Explain a concept that is new to the user with a visual, single-file HTML report saved in the vault and linked from the task. Use when the user says /teach, "teach me X", "explain X visually", or when a task depends on a concept they clearly don't know yet.
---

# Teach

Assume a small brain: zero jargon without a definition, one idea per section, pictures over paragraphs.

1. Pin the concept and the context. If there is a task (`$TASK_ID` or given), read it and its repo so the examples come from the user's real code and data.
2. Write `~/Projects/second-brain/vault/reports/<YYYY-MM-DD>-<concept-slug>.html`, one self-contained file:
   - Title + a one-sentence "In short".
   - 3 to 6 sections, each with an inline SVG diagram (boxes and arrows, a timeline, a before/after) and at most 3 short sentences under it.
   - One concrete example from the user's own codebase or task.
   - "Common mistakes" (2-3 bullets) and "Check yourself": 3 questions with answers hidden in `<details>`.
   - Inline CSS only, no external scripts. Readable in light and dark (`prefers-color-scheme`), system font, max width ~760px.
3. Link it from the task body under `## Reports` (create the heading if missing): `- [<concept>](../reports/<file>.html) YYYY-MM-DD`. Set `updated` to today.
4. Open it: `open <file>`. Reply with one line and the path.

## Finding related notes

Search the whole vault by meaning (local embeddings): `node ~/Projects/second-brain/scripts/vault-search.mjs "<question>"`. Use it before asking the user something the vault may already answer.
