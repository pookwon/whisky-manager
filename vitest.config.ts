import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Electron entry points cannot run outside an Electron process; they are
      // covered by launching the app, not by unit tests.
      exclude: ['src/desktop/main.ts', 'src/desktop/preload.ts', 'src/extension/**'],
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
})
