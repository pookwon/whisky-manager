import { describe, expect, it } from 'vitest'
import { createOpenFileInstaller } from '../../src/desktop/openFileInstaller.js'
import { WINDOWS_UPDATE_SCRIPT, createWindowsMsiInstaller } from '../../src/desktop/windowsMsiInstaller.js'

function windowsPorts(overrides: { spawn?: boolean; write?: boolean } = {}) {
  const calls: { command: string; args: readonly string[] }[] = []
  const written: { path: string; text: string }[] = []
  const installer = createWindowsMsiInstaller({
    directory: 'C:\\Users\\op\\AppData\\Roaming\\whisky-manager\\updates',
    logDirectory: 'C:\\Users\\op\\AppData\\Roaming\\whisky-manager',
    executablePath: 'C:\\Users\\op\\AppData\\Local\\Programs\\Whisky Manager\\Whisky Manager.exe',
    processId: 4321,
    writeFile: (path, text) => {
      if (overrides.write === false) throw new Error('disk full')
      written.push({ path, text })
    },
    spawnDetached: async (command, args) => {
      calls.push({ command, args })
      return overrides.spawn !== false
    },
  })
  return { installer, calls, written }
}

describe('the Windows installer', () => {
  it('hands the file to a hidden helper and asks the app to end', async () => {
    const { installer, calls, written } = windowsPorts()

    const handoff = await installer.install('C:\\updates\\Whisky-Manager-1.9.18.msi')

    expect(handoff).toEqual({ kind: 'launched', quitsApp: true })
    expect(written).toHaveLength(1)
    expect(written[0]?.text).toBe(WINDOWS_UPDATE_SCRIPT)
    expect(calls).toHaveLength(1)
    const { command, args } = calls[0]!
    expect(command).toBe('powershell.exe')
    expect(args).toContain('-File')
    expect(args[args.indexOf('-AppPid') + 1]).toBe('4321')
    expect(args[args.indexOf('-Installer') + 1]).toBe('C:\\updates\\Whisky-Manager-1.9.18.msi')
    expect(args[args.indexOf('-Executable') + 1]).toContain('Whisky Manager.exe')
  })

  it('never puts a path into the script text', async () => {
    const { installer, written } = windowsPorts()
    await installer.install('C:\\updates\\Whisky-Manager-1.9.18.msi')

    expect(written[0]?.text).not.toContain('Whisky-Manager-1.9.18')
    expect(written[0]?.text).not.toContain('AppData')
  })

  it('reports failure, and stops nothing, when the helper cannot start', async () => {
    const { installer } = windowsPorts({ spawn: false })
    expect(await installer.install('x.msi')).toEqual({ kind: 'failed', reason: 'INSTALLER_UNAVAILABLE' })
  })

  it('reports failure when the helper cannot be written', async () => {
    const { installer, calls } = windowsPorts({ write: false })
    expect(await installer.install('x.msi')).toEqual({ kind: 'failed', reason: 'INSTALLER_UNAVAILABLE' })
    expect(calls).toEqual([])
  })
})

describe('the helper script', () => {
  it('waits for the app, refuses to install over it, and always tries to relaunch', () => {
    expect(WINDOWS_UPDATE_SCRIPT).toContain('Get-Process -Id $AppPid')
    expect(WINDOWS_UPDATE_SCRIPT).toContain("Note 'APP_STILL_RUNNING'")
    expect(WINDOWS_UPDATE_SCRIPT).toContain('/qn')
    expect(WINDOWS_UPDATE_SCRIPT).toContain('Start-Process -FilePath $Executable')
  })

  it('stops what the app left running in the install folder once the app itself is gone', () => {
    expect(WINDOWS_UPDATE_SCRIPT).toContain('InstallFolderProcesses')
    expect(WINDOWS_UPDATE_SCRIPT).toContain('Split-Path -Parent $Executable')
    expect(WINDOWS_UPDATE_SCRIPT).toContain('Stop-Process -Force')
    expect(WINDOWS_UPDATE_SCRIPT).toContain("Note ('LEFTOVER_PROCESSES")
    const gone = WINDOWS_UPDATE_SCRIPT.indexOf("Note 'APP_STILL_RUNNING'")
    expect(WINDOWS_UPDATE_SCRIPT.indexOf('Stop-Process -Force')).toBeGreaterThan(gone)
  })

  it('moves its working folder out of the install folder before installing', () => {
    const moved = WINDOWS_UPDATE_SCRIPT.indexOf('Set-Location')
    expect(moved).toBeGreaterThan(-1)
    expect(moved).toBeLessThan(WINDOWS_UPDATE_SCRIPT.indexOf("'msiexec.exe'"))
  })

  it('tries the installer again after a failed write, each attempt with its own log', () => {
    expect(WINDOWS_UPDATE_SCRIPT).toContain('$installAttempts = 3')
    expect(WINDOWS_UPDATE_SCRIPT).toContain("'{0}.{1}' -f $InstallLog, $attempt")
  })

  it('stamps its notes in KST', () => {
    expect(WINDOWS_UPDATE_SCRIPT).toContain('AddHours($kstOffsetHours)')
    expect(WINDOWS_UPDATE_SCRIPT).toContain('$kstOffsetHours = 9')
  })
})

describe('the open-the-file installer', () => {
  it('leaves the app running once the file is open', async () => {
    const installer = createOpenFileInstaller({ openPath: async () => '' })
    expect(await installer.install('a.dmg')).toEqual({ kind: 'opened', quitsApp: false })
  })

  it('reports failure when the shell could not open it', async () => {
    const installer = createOpenFileInstaller({ openPath: async () => 'no application' })
    expect(await installer.install('a.dmg')).toEqual({ kind: 'failed', reason: 'INSTALLER_UNAVAILABLE' })
  })
})
