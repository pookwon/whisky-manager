import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assetNamerFor } from '../shared/releaseSelection.js'
import { createOpenFileInstaller } from './openFileInstaller.js'
import { createUpdateCoordinator, type UpdateCoordinator, type UpdateInstaller } from './updateCoordinator.js'
import { downloadUpdate, type HttpPort } from './updateDownload.js'
import { createUpdateMarker, type UpdateOutcome } from './updateMarker.js'
import { createWindowsMsiInstaller } from './windowsMsiInstaller.js'

const CHECK_EVERY_MS = 6 * 60 * 60_000
const POLL_EVERY_MS = 30_000
const UPDATES_DIRNAME = 'updates'
const MARKER_FILENAME = 'update-pending.json'

export interface UpdateRuntimeDeps {
  readonly platform: string
  readonly arch: string
  readonly currentVersion: string
  /** Only an installed build replaces itself; a development run must never. */
  readonly enabled: boolean
  readonly userDataDirectory: string
  readonly executablePath: string
  readonly processId: number
  readonly fetchLatestRelease: () => Promise<unknown>
  readonly http: HttpPort
  readonly openPath: (path: string) => Promise<string>
  readonly spawnDetached: (command: string, args: readonly string[]) => Promise<boolean>
  readonly isBusy: () => boolean
  readonly shutdown: () => Promise<void>
  readonly exit: () => void
}

export interface UpdateRuntime {
  readonly coordinator: UpdateCoordinator
  /** How the install attempted by the previous run ended; read once, at construction. */
  readonly previousOutcome: UpdateOutcome
  /** Begins checking now and on a schedule. Does nothing where updates are not supported. */
  start(): void
  stop(): void
}

function installerFor(deps: UpdateRuntimeDeps, directory: string): UpdateInstaller {
  if (deps.platform === 'win32') {
    return createWindowsMsiInstaller({
      directory,
      logDirectory: deps.userDataDirectory,
      executablePath: deps.executablePath,
      processId: deps.processId,
      writeFile: (path, text) => writeFileSync(path, text),
      spawnDetached: deps.spawnDetached,
    })
  }
  // Without a signature nothing can be installed unattended elsewhere; the
  // operator is handed the file instead.
  return createOpenFileInstaller({ openPath: deps.openPath })
}

/**
 * Assembles the update machinery from plain ports, so everything that touches
 * Electron stays in the shell and this stays free of it.
 */
export function createUpdateRuntime(deps: UpdateRuntimeDeps): UpdateRuntime {
  const directory = join(deps.userDataDirectory, UPDATES_DIRNAME)
  const marker = createUpdateMarker(join(deps.userDataDirectory, MARKER_FILENAME))
  const namer = assetNamerFor(deps.platform, deps.arch)
  const previousOutcome = marker.settle(deps.currentVersion)

  const coordinator = createUpdateCoordinator({
    currentVersion: deps.currentVersion,
    assetName: namer ?? (() => ''),
    fetchLatestRelease: deps.fetchLatestRelease,
    download: (candidate) => {
      mkdirSync(directory, { recursive: true })
      return downloadUpdate(candidate, directory, deps.http)
    },
    installer: installerFor(deps, directory),
    isBusy: deps.isBusy,
    writePending: (pending) => marker.write(pending),
    clearPending: () => marker.clear(),
    shutdown: deps.shutdown,
    exit: deps.exit,
  })

  if (previousOutcome === 'failed') coordinator.reportFailure('INSTALL_FAILED')

  let timers: readonly ReturnType<typeof setInterval>[] = []

  return {
    coordinator,
    previousOutcome,
    start() {
      if (!deps.enabled || namer === null || timers.length > 0) return
      void coordinator.check()
      timers = [
        setInterval(() => void coordinator.check(), CHECK_EVERY_MS),
        setInterval(() => void coordinator.poll(), POLL_EVERY_MS),
      ]
    },
    stop() {
      for (const timer of timers) clearInterval(timer)
      timers = []
    },
  }
}
