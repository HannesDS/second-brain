import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { vaultApi } from './board/api'

export default defineConfig({
  root: 'board',
  plugins: [react(), vaultApi()],
  // frappe-gantt ships its CSS without exporting the path.
  resolve: { alias: { 'frappe-gantt.css': fileURLToPath(new URL('./node_modules/frappe-gantt/dist/frappe-gantt.css', import.meta.url)) } },
  server: { port: 5175, open: true },
})
