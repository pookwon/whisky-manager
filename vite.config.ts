import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { applyExtensionChannel, extensionChannel, type ExtensionManifest } from './src/extension/manifestChannel.js'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    // Readable output: chrome reports extension errors by file and line, and a
    // minified bundle turns every report into 'line 1'.
    minify: false,
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
        copyFileSync(here('src/extension/options.html'), here('dist/extension/options.html'))

        // The manifest is the one file a development build alters, so that the
        // two extensions an operator's browser may hold are told apart by name.
        const manifest = JSON.parse(readFileSync(here('src/extension/manifest.json'), 'utf8')) as ExtensionManifest
        const channel = extensionChannel(process.env.WM_EXTENSION_CHANNEL)
        writeFileSync(
          here('dist/extension/manifest.json'),
          `${JSON.stringify(applyExtensionChannel(manifest, channel), null, 2)}\n`,
        )
      },
    },
  ],
})
