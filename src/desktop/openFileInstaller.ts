import type { InstallHandoff, UpdateInstaller } from './updateCoordinator.js'

export interface OpenFilePorts {
  /** Opens a file with its default application; resolves to '' on success, as Electron's `shell.openPath` does. */
  readonly openPath: (path: string) => Promise<string>
}

/**
 * Where no unattended install is possible, the file is put in front of the
 * operator and the app keeps running. It is the fallback for every platform
 * and the only way on a build that is not signed.
 */
export function createOpenFileInstaller(ports: OpenFilePorts): UpdateInstaller {
  return {
    async install(filePath: string): Promise<InstallHandoff> {
      const failure = await ports.openPath(filePath)
      return failure === '' ? { kind: 'opened', quitsApp: false } : { kind: 'failed', reason: 'INSTALLER_UNAVAILABLE' }
    },
  }
}
