# second-brain

A local, Notion-like workbench on top of a markdown vault, wired into Claude Code.

- **Vault:** plain markdown with YAML frontmatter (projects, tasks, meetings, notes). It's a normal Obsidian vault and lives in its own (private) repo, cloned into `vault/`.
- **Workbench:** Vite + React. My day, notes with an agent that proposes where they belong, calendar, board, timeline, project cards, an overview of every Claude Code session, terminals, and semantic search (local Ollama embeddings).
- **Claude Code:** `task`, `grill` and `teach` skills, plus hooks that link sessions to tasks and report which agents need you. Supports two accounts (`~/.claude` and `~/.claude-personal`), chosen per project.
- **Sync:** pushes task status to a Notion board, pulls stories assigned to you, and closes tasks when their PR merges.

## Setup

```bash
git clone git@github.com:HannesDS/second-brain.git && cd second-brain
git clone <your private vault repo> vault
npm install
npm run install-claude   # skills + hooks in both Claude accounts, shell aliases
ollama pull nomic-embed-text
npm run dev              # http://localhost:5175
```

Optional `.env.local`: `NOTION_TOKEN`, `NOTION_ROADMAP_DB`, `NOTION_USER_ID`, `NOTION_DEFAULT_PROJECT`, `CALENDAR_ICS`. The vault's `notes/Guide.md` explains day-to-day use; it's also shown on the Guide tab.

A vault needs at least `projects/`, `tasks/`, `meetings/`, `notes/`, `inbox/` and `sessions/`. See `.claude/skills/task/SKILL.md` for the frontmatter fields.
