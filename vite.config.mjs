import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  build: {
    outDir: 'renderer',
    emptyOutDir: true,
    // Das Panel ist eine Single-Page-App mit allen Seiten in einem Bundle;
    // code splitting lohnt hier nicht (lokale Datei, kein Netz-Ladepfad).
    chunkSizeWarningLimit: 800
  },
  server: {
    port: 5173,
    strictPort: true
  }
})