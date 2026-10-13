import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PendingUpdate } from './updateCoordinator.js'

/** What the previous run's install attempt came to, seen from the run that follows it. */
export type UpdateOutcome = 'installed' | 'failed' | 'none'

export interface UpdateMarker {
  /** Records that an install is about to start; false when the record could not be made. */
  write(pending: PendingUpdate): boolean
  clear(): void
  /** Reads the record left by the run before this one, removes it, and says how it ended. */
  settle(currentVersion: string): UpdateOutcome
}

function isPending(value: unknown): value is PendingUpdate {
  if (typeof value !== 'object' || value === null) return false
  const { from, to } = value as Partial<PendingUpdate>
  return typeof from === 'string' && typeof to === 'string'
}

/**
 * A file that exists exactly while an install is under way.
 *
 * The app that starts afterwards is the only witness to how the install went,
 * so the file carries what it was meant to become. A version that is neither
 * the one it left nor the one it aimed at — an install done by hand in the
 * meantime — is not this record's business and says nothing either way.
 */
export function createUpdateMarker(path: string): UpdateMarker {
  return {
    write(pending) {
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, JSON.stringify(pending))
        return true
      } catch {
        return false
      }
    },

    clear() {
      rmSync(path, { force: true })
    },

    settle(currentVersion) {
      if (!existsSync(path)) return 'none'
      let pending: unknown = null
      try {
        pending = JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        // An unreadable record is as good as none; leaving it would only make
        // every later start look at it again.
      }
      rmSync(path, { force: true })
      if (!isPending(pending)) return 'none'
      if (currentVersion === pending.to) return 'installed'
      if (currentVersion === pending.from) return 'failed'
      return 'none'
    },
  }
}
