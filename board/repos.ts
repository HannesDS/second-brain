// Where a task's code lives, shared by the API (agents start there) and the sync (gh runs there).
import fs from 'node:fs'
import os from 'node:os'
import { ROOT } from '../lib/vault.mjs'

export const expand = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir())
export const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : [])

// The folder Claude works in for a task or project: the task's repo, else the project's first existing repo.
export function workdir(p?: { data: Record<string, any> }, t?: { data: Record<string, any> }) {
  return [t?.data.repo, ...asList(p?.data.repos)].filter(Boolean).map(expand).find((d) => fs.existsSync(d)) ?? ROOT
}
