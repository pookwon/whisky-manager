import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface RestagePorts {
  /** The version of this app, which the staged copy has to match. */
  readonly appVersion: string
  /** The folder Chrome loaded the extension from; nothing is done unless it exists. */
  readonly stagedDirectory: string
  /** The app version that last put files in that folder, or null if never recorded. */
  readonly readStagedVersion: () => string | null
  readonly writeStagedVersion: (version: string) => void
  /** Copies the bundled extension over the staged one. */
  readonly stage: () => void
}

/**
 * Brings the staged extension up to this app's version, once per app version.
 *
 * Only a folder the operator already set up is touched: creating one here
 * would put files where Chrome was never told to look, and the setup guide
 * stays the only thing that does that. True means files were rewritten, which
 * is the only time a running extension is out of date.
 */
export function restageExtensionIfOutdated(ports: RestagePorts): boolean {
  if (!existsSync(ports.stagedDirectory)) return false
  if (ports.readStagedVersion() === ports.appVersion) return false
  ports.stage()
  ports.writeStagedVersion(ports.appVersion)
  return true
}

export interface ReloadFacts {
  /** Files were rewritten by this run and no reload has been asked for yet. */
  readonly armed: boolean
  readonly appVersion: string
  /** What the connected extension reports about itself; null when it sends none. */
  readonly extensionVersion: string | null
}

/**
 * Whether the extension now connected should be told to reload.
 *
 * An extension already reporting this app's version has nothing to re-read,
 * which is also what ends the exchange: a reload that worked comes back
 * reporting the new version, so it can never be asked twice in a row.
 */
export function shouldReloadExtension(facts: ReloadFacts): boolean {
  return facts.armed && facts.extensionVersion !== facts.appVersion
}

/** The recorded staged version in a plain file, which survives the app being replaced. */
export function createStagedVersionFile(path: string): Pick<RestagePorts, 'readStagedVersion' | 'writeStagedVersion'> {
  return {
    readStagedVersion() {
      try {
        const text = readFileSync(path, 'utf8').trim()
        return text === '' ? null : text
      } catch {
        return null
      }
    },
    writeStagedVersion(version) {
      writeFileSync(path, version)
    },
  }
}
