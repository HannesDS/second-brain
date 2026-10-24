# Brain Terrain

Before you commit, run `npm run check` (TypeScript) and `npm test` (Vitest). Logic you add or change gets a test next to its module (`*.test.ts`, or `*.test.mjs` in `lib/` and `scripts/`); point tests at a scratch vault with `SECOND_BRAIN_VAULT`, never the real one.

UI work in `board/`: read `docs/DESIGN.md` first. The workbench has themes (Terrain by default, Classic as fallback).
Use tokens, never hex in components, and keep theme-specific CSS in that theme's file, scoped to `[data-theme="<name>"]`.

## Agent skills

### Issue tracker

Tickets are tasks in the vault (`vault/tasks/`, project `[[workbench]]`); new ones start as `status: todo`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles map to task statuses. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root, created when needed. See `docs/agents/domain.md`.
