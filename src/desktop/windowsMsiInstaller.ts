import { join } from 'node:path'
import type { InstallHandoff, UpdateInstaller } from './updateCoordinator.js'

/**
 * The helper that outlives the app. It is a fixed text: every path and number
 * reaches it as a parameter, never spliced into the script, so a file name
 * cannot become code.
 *
 * It does not install over a live app, and it always tries to leave the
 * operator with something running — the new version, or, when the install did
 * not take, the old one the installer rolled back to.
 */
export const WINDOWS_UPDATE_SCRIPT = `param(
  [Parameter(Mandatory = $true)][int]$AppPid,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$InstallLog,
  [Parameter(Mandatory = $true)][string]$ErrorLog
)
$ErrorActionPreference = 'Continue'
$kstOffsetHours = 9
$waitForExitSeconds = 60
$installTimeoutMs = 600000
$relaunchWaitSeconds = 10

function Note([string]$text) {
  $stamp = (Get-Date).ToUniversalTime().AddHours($kstOffsetHours).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -LiteralPath $ErrorLog -Value ('{0} KST {1}' -f $stamp, $text)
}

$deadline = (Get-Date).AddSeconds($waitForExitSeconds)
while ((Get-Process -Id $AppPid -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
  Start-Sleep -Milliseconds 500
}
if (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) {
  Note 'APP_STILL_RUNNING'
  Start-Process -FilePath $Installer
  exit 1
}

$arguments = @('/i', ('"{0}"' -f $Installer), '/qn', '/norestart', '/l*v', ('"{0}"' -f $InstallLog))
$install = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -PassThru
if (-not $install.WaitForExit($installTimeoutMs)) {
  Note 'MSIEXEC_TIMEOUT'
} elseif (($install.ExitCode -ne 0) -and ($install.ExitCode -ne 3010)) {
  Note ('MSIEXEC_EXIT {0}' -f $install.ExitCode)
}

if (-not (Test-Path -LiteralPath $Executable)) {
  Note 'EXECUTABLE_MISSING'
  Start-Process -FilePath $Installer
  exit 1
}
Start-Process -FilePath $Executable
Start-Sleep -Seconds $relaunchWaitSeconds
$name = [System.IO.Path]::GetFileNameWithoutExtension($Executable)
if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue)) {
  Note 'RELAUNCH_NOT_SEEN'
  Start-Process -FilePath $Installer
}
`

export const WINDOWS_UPDATE_SCRIPT_NAME = 'apply-update.ps1'
export const INSTALL_LOG_NAME = 'update-install.log'
export const ERROR_LOG_NAME = 'update-error.log'

export interface WindowsMsiPorts {
  /** Where the update files and helper live; the app's own `updates` folder. */
  readonly directory: string
  /** This app's executable and process id: what the helper waits for and restarts. */
  readonly executablePath: string
  readonly processId: number
  /** The folder the helper's two logs are written to. */
  readonly logDirectory: string
  readonly writeFile: (path: string, text: string) => void
  /** Starts a process that outlives this one; false when it could not be started. */
  readonly spawnDetached: (command: string, args: readonly string[]) => Promise<boolean>
}

/** Hands the installer to a helper and asks the app to end so the helper can run. */
export function createWindowsMsiInstaller(ports: WindowsMsiPorts): UpdateInstaller {
  return {
    async install(filePath: string): Promise<InstallHandoff> {
      const scriptPath = join(ports.directory, WINDOWS_UPDATE_SCRIPT_NAME)
      try {
        ports.writeFile(scriptPath, WINDOWS_UPDATE_SCRIPT)
      } catch {
        return { kind: 'failed', reason: 'INSTALLER_UNAVAILABLE' }
      }

      const started = await ports.spawnDetached('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        scriptPath,
        '-AppPid',
        String(ports.processId),
        '-Installer',
        filePath,
        '-Executable',
        ports.executablePath,
        '-InstallLog',
        join(ports.logDirectory, INSTALL_LOG_NAME),
        '-ErrorLog',
        join(ports.logDirectory, ERROR_LOG_NAME),
      ])
      return started ? { kind: 'launched', quitsApp: true } : { kind: 'failed', reason: 'INSTALLER_UNAVAILABLE' }
    },
  }
}
