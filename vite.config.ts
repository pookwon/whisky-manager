import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: here('src/extension/background.ts'),
        options: here('src/extension/options.ts'),
      },
      output: { entryFileNames: '[name].js', format: 'es' },
    },
  },
  plugins: [
    {
      name: 'copy-manifest',
      closeBundle() {
        mkdirSync(here('dist/extension'), { recursive: true })
        for (const file of ['manifest.json', 'options.html']) {
          copyFileSync(here(`src/extension/${file}`), here(`dist/extension/${file}`))
        }
      },
    },
  ],
})
