import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStagedVersionFile, restageExtensionIfOutdated, shouldReloadExtension } from '../../src/desktop/extensionRestage.js'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'wm-restage-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function build(options: { staged: boolean; recorded: string | null }) {
  const calls: string[] = []
  let recorded = options.recorded
  const ports = {
    appVersion: '1.9.18',
    stagedDirectory: options.staged ? directory : join(directory, 'never-set-up'),
    readStagedVersion: () => recorded,
    writeStagedVersion: (version: string) => {
      recorded = version
      calls.push(`record ${version}`)
    },
    stage: () => {
      calls.push('stage')
    },
  }
  return { ports, calls }
}

describe('restaging the extension after an update', () => {
  it('rewrites an outdated folder once and records the version', () => {
    const { ports, calls } = build({ staged: true, recorded: '1.9.17' })

    expect(restageExtensionIfOutdated(ports)).toBe(true)
    expect(calls).toEqual(['stage', 'record 1.9.18'])
    expect(restageExtensionIfOutdated(ports)).toBe(false)
  })

  it('treats a folder with no recorded version as outdated', () => {
    const { ports } = build({ staged: true, recorded: null })
    expect(restageExtensionIfOutdated(ports)).toBe(true)
  })

  it('does not create a folder the operator never set up', () => {
    const { ports, calls } = build({ staged: false, recorded: null })

    expect(restageExtensionIfOutdated(ports)).toBe(false)
    expect(calls).toEqual([])
  })

  it('keeps the recorded version in a file', () => {
    const file = createStagedVersionFile(join(directory, 'staged-app-version'))
    expect(file.readStagedVersion()).toBeNull()

    file.writeStagedVersion('1.9.18')
    expect(file.readStagedVersion()).toBe('1.9.18')
  })
})

describe('asking the extension to reload', () => {
  it('asks an extension that is still the old build', () => {
    expect(shouldReloadExtension({ armed: true, appVersion: '1.9.18', extensionVersion: '1.9.17' })).toBe(true)
    expect(shouldReloadExtension({ armed: true, appVersion: '1.9.18', extensionVersion: null })).toBe(true)
  })

  it('does not ask one that already reports this version, which is what ends a reload', () => {
    expect(shouldReloadExtension({ armed: true, appVersion: '1.9.18', extensionVersion: '1.9.18' })).toBe(false)
  })

  it('does not ask when nothing was restaged', () => {
    expect(shouldReloadExtension({ armed: false, appVersion: '1.9.18', extensionVersion: '1.9.17' })).toBe(false)
  })
})
