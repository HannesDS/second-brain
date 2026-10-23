# second-brain

UI work in `board/`: read `docs/DESIGN.md` first. The workbench has themes (Terrain by default, Classic as fallback).
Use tokens, never hex in components, and keep theme-specific CSS in that theme's file, scoped to `[data-theme="<name>"]`.
