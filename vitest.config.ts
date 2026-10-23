import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts, whose root is board/ and whose plugin starts the vault API.
export default defineConfig({
  test: { include: ['{board,lib,scripts}/**/*.test.{ts,mjs}'] },
})
