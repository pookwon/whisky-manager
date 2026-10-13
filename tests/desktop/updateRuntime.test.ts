import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createUpdateRuntime, type UpdateRuntimeDeps } from '../../src/desktop/updateRuntime.js'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'wm-runtime-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function deps(overrides: Partial<UpdateRuntimeDeps> = {}): UpdateRuntimeDeps {
  return {
    platform: 'win32',
    arch: 'x64',
    currentVersion: '1.9.18',
    enabled: true,
    userDataDirectory: directory,
    executablePath: 'C:\\app\\Whisky Manager.exe',
    processId: 1,
    fetchLatestRelease: async () => ({}),
    http: { get: async () => ({ status: 404, location: null, body: null }) },
    openPath: async () => '',
    spawnDetached: async () => true,
    isBusy: () => false,
    shutdown: async () => {},
    exit: () => {},
    ...overrides,
  }
}

describe('the update runtime', () => {
  it('shows an install that did not take as a failure, once', () => {
    writeFileSync(join(directory, 'update-pending.json'), JSON.stringify({ from: '1.9.18', to: '1.9.19' }))

    const runtime = createUpdateRuntime(deps())

    expect(runtime.previousOutcome).toBe('failed')
    expect(runtime.coordinator.state()).toEqual({ kind: 'failed', reason: 'INSTALL_FAILED' })
    expect(createUpdateRuntime(deps()).previousOutcome).toBe('none')
  })

  it('stays quiet after an install that took', () => {
    writeFileSync(join(directory, 'update-pending.json'), JSON.stringify({ from: '1.9.17', to: '1.9.18' }))

    const runtime = createUpdateRuntime(deps())

    expect(runtime.previousOutcome).toBe('installed')
    expect(runtime.coordinator.state()).toEqual({ kind: 'idle' })
  })

  it('does not look for updates in a development run', async () => {
    let looked = false
    const runtime = createUpdateRuntime(deps({ enabled: false, fetchLatestRelease: async () => ((looked = true), {}) }))

    runtime.start()
    runtime.stop()

    expect(looked).toBe(false)
  })

  it('looks once at start and stops cleanly', async () => {
    let looks = 0
    const runtime = createUpdateRuntime(deps({ fetchLatestRelease: async () => ((looks += 1), {}) }))

    runtime.start()
    runtime.start()
    runtime.stop()
    await Promise.resolve()

    expect(looks).toBe(1)
  })

  it('writes the marker before handing over and clears it when the hand-over fails', async () => {
    const release = {
      tag_name: 'v1.9.19',
      draft: false,
      prerelease: false,
      assets: [
        {
          name: 'Whisky-Manager-1.9.19.msi',
          size: 1,
          digest: `sha256:${'a'.repeat(64)}`,
          browser_download_url: 'https://github.com/pookwon/whisky-manager/releases/download/v1.9.19/Whisky-Manager-1.9.19.msi',
        },
      ],
    }
    const bytes = Buffer.from('x')
    const { createHash } = await import('node:crypto')
    release.assets[0]!.digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    release.assets[0]!.size = bytes.byteLength
    const markerPath = join(directory, 'update-pending.json')
    let markerDuringSpawn: string | null = null
    const runtime = createUpdateRuntime(
      deps({
        fetchLatestRelease: async () => release,
        http: {
          get: async () => ({ status: 200, location: null, body: (async function* () { yield bytes })() }),
        },
        spawnDetached: async () => {
          markerDuringSpawn = readFileSync(markerPath, 'utf8')
          return false
        },
      }),
    )

    await runtime.coordinator.check()
    expect(runtime.coordinator.state()).toEqual({ kind: 'ready', version: '1.9.19' })
    await runtime.coordinator.apply()

    expect(JSON.parse(markerDuringSpawn ?? 'null')).toEqual({ from: '1.9.18', to: '1.9.19' })
    expect(runtime.coordinator.state()).toEqual({ kind: 'failed', reason: 'INSTALLER_UNAVAILABLE' })
    expect(() => readFileSync(markerPath)).toThrow()
  })
})
