import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stageExtension } from '../../src/desktop/extensionBundle.js'

let root: string
let source: string
let target: string

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wm-extension-'))
  source = join(root, 'bundled')
  target = join(root, 'staged')
  mkdirSync(source, { recursive: true })
  write(join(source, 'manifest.json'), '{"manifest_version":3}')
  write(join(source, 'background.js'), 'export {}')
  write(join(source, 'assets', 'icon.txt'), 'icon')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('staging the bundled extension', () => {
  it('puts the whole bundle where Chrome can read it', () => {
    expect(stageExtension(source, target)).toBe(target)

    expect(readFileSync(join(target, 'manifest.json'), 'utf8')).toBe('{"manifest_version":3}')
    expect(readFileSync(join(target, 'background.js'), 'utf8')).toBe('export {}')
    expect(readFileSync(join(target, 'assets', 'icon.txt'), 'utf8')).toBe('icon')
  })

  /**
   * Chrome remembers an unpacked extension by its path, so a second press has
   * to land on the same folder. Naming a different one would register a second
   * extension and orphan the pairing the operator already made.
   */
  it('reuses the same folder on a second run', () => {
    stageExtension(source, target)
    expect(stageExtension(source, target)).toBe(target)
    expect(existsSync(join(target, 'manifest.json'))).toBe(true)
  })

  it('carries a changed file over the old one', () => {
    stageExtension(source, target)
    write(join(source, 'background.js'), 'export const version = 2')

    stageExtension(source, target)

    expect(readFileSync(join(target, 'background.js'), 'utf8')).toBe('export const version = 2')
  })

  it('clears out what a newer build no longer ships', () => {
    stageExtension(source, target)
    rmSync(join(source, 'background.js'))

    stageExtension(source, target)

    expect(existsSync(join(target, 'background.js'))).toBe(false)
    expect(existsSync(join(target, 'manifest.json'))).toBe(true)
  })

  /** A file may not be copied over a directory of the same name. */
  it('replaces a staged entry whose kind changed', () => {
    stageExtension(source, target)
    rmSync(join(source, 'assets'), { recursive: true })
    write(join(source, 'assets'), 'now a file')

    stageExtension(source, target)

    expect(readFileSync(join(target, 'assets'), 'utf8')).toBe('now a file')
  })

  /**
   * The alternative is Chrome telling the operator it cannot find
   * manifest.json, which points at them rather than at a build that shipped
   * without the extension in it.
   */
  it('refuses a source that holds no manifest', () => {
    rmSync(join(source, 'manifest.json'))

    expect(() => stageExtension(source, target)).toThrow(/manifest\.json/)
    expect(existsSync(target)).toBe(false)
  })
})
