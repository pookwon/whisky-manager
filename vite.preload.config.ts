import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  build: {
    outDir: here('dist/desktop'),
    emptyOutDir: false,
    minify: false,
    // Electron's sandboxed preload context has no ESM loader and can only
    // `require()` a handful of built-in modules, so this must ship as a
    // single dependency-free CommonJS file rather than tsc's ESM output.
    lib: {
      entry: here('src/desktop/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
})
