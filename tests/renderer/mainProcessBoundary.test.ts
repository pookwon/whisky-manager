import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url))

/** Whole import statements, including ones whose braces span several lines. */
const IMPORT = /import\s+(type\s+)?(?:\{[^}]*\}|[\w*\s,]+)\s+from\s+'([^']+)'|import\s+'([^']+)'/g

const DESKTOP_SPECIFIER = /^(\.\.\/)+desktop\//

/**
 * A value import reaches the bundle; `import type` is erased. Only the former
 * can drag the main process into the browser.
 */
function desktopValueImports(source: string): string[] {
  return [...source.matchAll(IMPORT)]
    .filter(([, typeOnly, from, sideEffect]) => {
      if (typeOnly !== undefined) return false
      const specifier = from ?? sideEffect ?? ''
      return DESKTOP_SPECIFIER.test(specifier)
    })
    .map(([statement]) => statement.replace(/\s+/g, ' '))
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('renderer / main process boundary', () => {
  /**
   * Importing a value from `src/desktop` pulls better-sqlite3, ws and drizzle
   * into the renderer bundle, which throws on load and leaves a blank window.
   * Nothing else in the suite notices — every test still passes — so this scan
   * is the only thing standing between that mistake and a shipped blank app.
   * Shared constants belong in `src/shared`.
   */
  it('never imports a value from the main process', () => {
    const offenders = sourceFiles(RENDERER).flatMap((file) =>
      desktopValueImports(readFileSync(file, 'utf8')).map(
        (statement) => `${file.slice(RENDERER.length + 1)}: ${statement}`,
      ),
    )

    expect(offenders).toEqual([])
  })

  it('recognises a named value import as an offender', () => {
    expect(
      desktopValueImports("import { WELCOME_AUTOMATION_ID } from '../desktop/bootstrap.js'"),
    ).toHaveLength(1)
  })

  it('recognises a side-effect import as an offender', () => {
    expect(desktopValueImports("import '../desktop/bootstrap.js'")).toHaveLength(1)
  })

  it('leaves single-line type-only imports alone', () => {
    expect(desktopValueImports("import type { RendererApi } from '../desktop/ipc.js'")).toEqual([])
  })

  it('leaves type-only imports whose braces span lines alone', () => {
    const sample = [
      "import { create } from 'zustand'",
      'import type {',
      '  AutomationSettingsView,',
      '  DashboardSnapshot,',
      "} from '../desktop/ipc.js'",
    ].join('\n')

    expect(desktopValueImports(sample)).toEqual([])
  })

  it('does not mistake a neighbouring package import for a desktop one', () => {
    const sample = ["import { create } from 'zustand'", "import { api } from './api.js'"].join('\n')

    expect(desktopValueImports(sample)).toEqual([])
  })
})
