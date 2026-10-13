import { describe, expect, it } from 'vitest'
import { createUpdateCoordinator, type InstallHandoff, type PendingUpdate, type UpdateCoordinatorPorts } from '../../src/desktop/updateCoordinator.js'
import type { DownloadResult } from '../../src/desktop/updateDownload.js'
import { assetNamerFor } from '../../src/shared/releaseSelection.js'
import type { UpdateState } from '../../src/shared/updateStatus.js'

const HEX = 'c'.repeat(64)

function release(version: string) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: `Whisky-Manager-${version}.msi`,
        size: 10,
        digest: `sha256:${HEX}`,
        browser_download_url: `https://github.com/pookwon/whisky-manager/releases/download/v${version}/Whisky-Manager-${version}.msi`,
      },
    ],
  }
}

interface Harness {
  readonly ports: UpdateCoordinatorPorts
  readonly log: string[]
  state: { busy: boolean; latest: unknown; fetchFails: boolean; download: DownloadResult; handoff: InstallHandoff; markerWritable: boolean }
  pending: PendingUpdate | null
}

function harness(): Harness {
  const log: string[] = []
  const h: Harness = {
    log,
    pending: null,
    state: {
      busy: false,
      latest: release('1.9.18'),
      fetchFails: false,
      download: { kind: 'downloaded', path: '/updates/Whisky-Manager-1.9.18.msi' },
      handoff: { kind: 'launched', quitsApp: true },
      markerWritable: true,
    },
    ports: {
      currentVersion: '1.9.17',
      assetName: assetNamerFor('win32', 'x64')!,
      fetchLatestRelease: async () => {
        log.push('fetch')
        if (h.state.fetchFails) throw new Error('offline')
        return h.state.latest
      },
      download: async (candidate) => {
        log.push(`download ${candidate.version}`)
        return h.state.download
      },
      installer: {
        install: async (path) => {
          log.push(`install ${path}`)
          return h.state.handoff
        },
      },
      isBusy: () => h.state.busy,
      writePending: (pending) => {
        log.push('writePending')
        if (!h.state.markerWritable) return false
        h.pending = pending
        return true
      },
      clearPending: () => {
        log.push('clearPending')
        h.pending = null
      },
      shutdown: async () => {
        log.push('shutdown')
      },
      exit: () => {
        log.push('exit')
      },
    },
  }
  return h
}

describe('looking for an update', () => {
  it('has the update ready after a check finds a newer release', async () => {
    const h = harness()
    const coordinator = createUpdateCoordinator(h.ports)
    const seen: UpdateState['kind'][] = []
    coordinator.subscribe((state) => seen.push(state.kind))

    await coordinator.check()

    expect(coordinator.state()).toEqual({ kind: 'ready', version: '1.9.18' })
    expect(seen).toEqual(['checking', 'downloading', 'ready'])
  })

  it('stays idle when this build is current', async () => {
    const h = harness()
    h.state.latest = release('1.9.17')
    const coordinator = createUpdateCoordinator(h.ports)

    await coordinator.check()

    expect(coordinator.state()).toEqual({ kind: 'idle' })
    expect(h.log).toEqual(['fetch'])
  })

  it('reports a failed look and tries again on the next one', async () => {
    const h = harness()
    h.state.fetchFails = true
    const coordinator = createUpdateCoordinator(h.ports)

    await coordinator.check()
    expect(coordinator.state()).toEqual({ kind: 'failed', reason: 'CHECK_FAILED' })

    h.state.fetchFails = false
    await coordinator.check()
    expect(coordinator.state()).toEqual({ kind: 'ready', version: '1.9.18' })
  })

  it('reports an unusable release and a failed download distinctly', async () => {
    const h = harness()
    h.state.latest = { ...release('1.9.18'), assets: [] }
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()
    expect(coordinator.state()).toEqual({ kind: 'failed', reason: 'RELEASE_UNUSABLE' })

    h.state.latest = release('1.9.18')
    h.state.download = { kind: 'failed', reason: 'DIGEST_MISMATCH' }
    await coordinator.check()
    expect(coordinator.state()).toEqual({ kind: 'failed', reason: 'DIGEST_MISMATCH' })
  })

  it('keeps a ready update through a failed or empty later check', async () => {
    const h = harness()
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()

    h.state.fetchFails = true
    await coordinator.check()
    expect(coordinator.state()).toEqual({ kind: 'ready', version: '1.9.18' })

    h.state.fetchFails = false
    await coordinator.check()
    expect(coordinator.state()).toEqual({ kind: 'ready', version: '1.9.18' })
    expect(h.log.filter((line) => line.startsWith('download'))).toHaveLength(1)
  })

  it('replaces a ready update with a newer release', async () => {
    const h = harness()
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()

    h.state.latest = release('1.9.19')
    h.state.download = { kind: 'downloaded', path: '/updates/Whisky-Manager-1.9.19.msi' }
    await coordinator.check()

    expect(coordinator.state()).toEqual({ kind: 'ready', version: '1.9.19' })
  })
})

describe('applying an update', () => {
  it('installs, then stops the app and exits, when nothing is running', async () => {
    const h = harness()
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()
    h.log.length = 0

    await coordinator.apply()

    expect(h.log).toEqual(['writePending', 'install /updates/Whisky-Manager-1.9.18.msi', 'shutdown', 'exit'])
    expect(h.pending).toEqual({ from: '1.9.17', to: '1.9.18' })
  })

  it('waits while work is running and installs the moment it ends', async () => {
    const h = harness()
    h.state.busy = true
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()

    await coordinator.apply()
    expect(coordinator.state()).toEqual({ kind: 'waitingIdle', version: '1.9.18' })
    await coordinator.poll()
    expect(h.log).not.toContain('exit')

    h.state.busy = false
    await coordinator.poll()
    expect(h.log.slice(-2)).toEqual(['shutdown', 'exit'])
  })

  it('does nothing further when the wait is withdrawn', async () => {
    const h = harness()
    h.state.busy = true
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()
    await coordinator.apply()

    coordinator.cancelWaiting()
    h.state.busy = false
    await coordinator.poll()

    expect(coordinator.state()).toEqual({ kind: 'ready', version: '1.9.18' })
    expect(h.log).not.toContain('exit')
  })

  it('does not install an update nobody pressed', async () => {
    const h = harness()
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()

    await coordinator.poll()

    expect(h.log).not.toContain('writePending')
  })

  it('does not stop anything when the installer cannot start', async () => {
    const h = harness()
    h.state.handoff = { kind: 'failed', reason: 'INSTALLER_UNAVAILABLE' }
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()

    await coordinator.apply()

    expect(coordinator.state()).toEqual({ kind: 'failed', reason: 'INSTALLER_UNAVAILABLE' })
    expect(h.log).not.toContain('shutdown')
    expect(h.log).not.toContain('exit')
    expect(h.pending).toBeNull()
  })

  it('does not install when the marker cannot be written', async () => {
    const h = harness()
    h.state.markerWritable = false
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()

    await coordinator.apply()

    expect(coordinator.state()).toEqual({ kind: 'failed', reason: 'MARKER_NOT_WRITTEN' })
    expect(h.log.some((line) => line.startsWith('install'))).toBe(false)
  })

  it('leaves the app running when the file was only opened for the operator', async () => {
    const h = harness()
    h.state.handoff = { kind: 'opened', quitsApp: false }
    const coordinator = createUpdateCoordinator(h.ports)
    await coordinator.check()

    await coordinator.apply()

    expect(coordinator.state()).toEqual({ kind: 'handedOver', version: '1.9.18' })
    expect(h.log).not.toContain('exit')
    expect(h.pending).toBeNull()
  })

  it('ignores a press when there is nothing ready', async () => {
    const h = harness()
    const coordinator = createUpdateCoordinator(h.ports)

    await coordinator.apply()

    expect(coordinator.state()).toEqual({ kind: 'idle' })
    expect(h.log).toEqual([])
  })
})
