import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: here('src/renderer'),
  // Electron loads the bundle from the filesystem, so asset URLs must be relative.
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: here('dist/renderer'),
    emptyOutDir: true,
  },
})
