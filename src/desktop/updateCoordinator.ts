import type { AssetNamer, UpdateCandidate } from '../shared/releaseSelection.js'
import { selectUpdate } from '../shared/releaseSelection.js'
import type { UpdateFailureReason, UpdateState } from '../shared/updateStatus.js'
import type { DownloadResult } from './updateDownload.js'

/** What an installer did with a downloaded file. */
export type InstallHandoff =
  /** A helper will do the install; the app has to end for it to be able to. */
  | { readonly kind: 'launched'; readonly quitsApp: true }
  /** The file was put in front of the operator, who finishes by hand; the app keeps running. */
  | { readonly kind: 'opened'; readonly quitsApp: false }
  | { readonly kind: 'failed'; readonly reason: 'INSTALLER_UNAVAILABLE' }

/** How a downloaded file becomes the running app. One implementation per platform. */
export interface UpdateInstaller {
  install(filePath: string): Promise<InstallHandoff>
}

export interface PendingUpdate {
  readonly from: string
  readonly to: string
}

export interface UpdateCoordinatorPorts {
  readonly currentVersion: string
  readonly assetName: AssetNamer
  /** The parsed `releases/latest` response; rejects when the network does. */
  readonly fetchLatestRelease: () => Promise<unknown>
  readonly download: (candidate: UpdateCandidate) => Promise<DownloadResult>
  readonly installer: UpdateInstaller
  /** True while any session, collection walk or probe is in flight. */
  readonly isBusy: () => boolean
  /** Records that an install is about to begin; false when it could not be recorded. */
  readonly writePending: (pending: PendingUpdate) => boolean
  readonly clearPending: () => void
  /** Stops all work and closes storage, bounded in time. */
  readonly shutdown: () => Promise<void>
  readonly exit: () => void
}

export interface UpdateCoordinator {
  state(): UpdateState
  subscribe(listener: (state: UpdateState) => void): () => void
  /** Looks for a newer release and, if there is one, gets it ready. */
  check(): Promise<void>
  /** The operator's press. Installs now if idle, otherwise as soon as idle. */
  apply(): Promise<void>
  /** Withdraws a press that is still waiting for work to end. */
  cancelWaiting(): void
  /** Called on a timer: installs a pressed update once nothing is running. */
  poll(): Promise<void>
  /** Shows a failure the coordinator did not see itself, such as an install a later run found had not taken. */
  reportFailure(reason: UpdateFailureReason): void
}

interface Prepared {
  readonly candidate: UpdateCandidate
  readonly path: string
}

export function createUpdateCoordinator(ports: UpdateCoordinatorPorts): UpdateCoordinator {
  let current: UpdateState = { kind: 'idle' }
  let prepared: Prepared | null = null
  const listeners = new Set<(state: UpdateState) => void>()

  function transition(next: UpdateState): void {
    current = next
    for (const listener of [...listeners]) listener(next)
  }

  function fail(reason: UpdateFailureReason): void {
    transition({ kind: 'failed', reason })
  }

  async function check(): Promise<void> {
    // A check on top of a download or an install would race it for the file.
    if (current.kind !== 'idle' && current.kind !== 'failed' && current.kind !== 'ready') return
    const before = current
    transition({ kind: 'checking' })

    let release: unknown
    try {
      release = await ports.fetchLatestRelease()
    } catch {
      // A failed look must not unready an update that is already waiting.
      if (before.kind === 'ready') transition(before)
      else fail('CHECK_FAILED')
      return
    }

    const selection = selectUpdate(release, ports.currentVersion, ports.assetName)
    if (selection.kind === 'none') {
      transition(before.kind === 'ready' ? before : { kind: 'idle' })
      return
    }
    if (selection.kind === 'rejected') {
      if (before.kind === 'ready') transition(before)
      else fail('RELEASE_UNUSABLE')
      return
    }

    const { candidate } = selection
    if (prepared !== null && prepared.candidate.version === candidate.version) {
      transition({ kind: 'ready', version: candidate.version })
      return
    }

    transition({ kind: 'downloading', version: candidate.version })
    const result = await ports.download(candidate)
    if (result.kind === 'failed') {
      if (before.kind === 'ready') transition(before)
      else fail(result.reason)
      return
    }
    prepared = { candidate, path: result.path }
    transition({ kind: 'ready', version: candidate.version })
  }

  async function proceed(): Promise<void> {
    if (current.kind !== 'waitingIdle' || prepared === null) return
    if (ports.isBusy()) return

    const { candidate, path } = prepared
    transition({ kind: 'applying', version: candidate.version })

    if (!ports.writePending({ from: ports.currentVersion, to: candidate.version })) {
      fail('MARKER_NOT_WRITTEN')
      return
    }

    // The helper is started before anything is stopped: if it cannot be
    // started the app is still whole, and nothing has been given up.
    const handoff = await ports.installer.install(path)
    if (handoff.kind === 'failed') {
      ports.clearPending()
      fail(handoff.reason)
      return
    }
    if (!handoff.quitsApp) {
      ports.clearPending()
      transition({ kind: 'handedOver', version: candidate.version })
      return
    }

    await ports.shutdown()
    ports.exit()
  }

  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    check,
    async apply() {
      if (current.kind !== 'ready') return
      transition({ kind: 'waitingIdle', version: current.version })
      await proceed()
    },
    cancelWaiting() {
      if (current.kind === 'waitingIdle') transition({ kind: 'ready', version: current.version })
    },
    poll: proceed,
    reportFailure: fail,
  }
}
