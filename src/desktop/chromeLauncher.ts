import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * Everything finding and starting Chrome touches outside itself. Injected so
 * the Windows search order — the one that matters, since the operators run
 * Windows and only development happens on a Mac — can be tested from macOS.
 */
export interface ChromeHost {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly exists: (path: string) => boolean
  readonly start: (executable: string) => void
}

/**
 * Where Chrome installs itself, most likely first.
 *
 * On Windows a per-user install under LOCALAPPDATA is what a normal account
 * gets when nobody had admin rights, and it shadows a machine-wide one, so it
 * is asked about first. `ProgramFiles(x86)` is still worth asking: a 32-bit
 * Chrome installed years ago and updated in place is left there.
 */
export function chromeCandidates(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']]
    return roots
      .filter((root): root is string => root !== undefined && root !== '')
      .map((root) => `${root}\\Google\\Chrome\\Application\\chrome.exe`)
  }

  if (platform === 'darwin') {
    const home = env.HOME ?? ''
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ...(home === '' ? [] : [`${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`]),
    ]
  }

  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ]
}

/** The first Chrome actually on disk, or null when none of them is. */
export function findChrome(host: ChromeHost): string | null {
  return chromeCandidates(host.platform, host.env).find((path) => host.exists(path)) ?? null
}

/**
 * Brings Chrome up, and says whether it could. Starting an already-running
 * Chrome opens a new tab in it, which is what the operator needs: a new tab
 * puts the caret in the address bar, and the extensions address is already on
 * their clipboard by the time they get there.
 *
 * No url is passed. Chrome discards `chrome://` arguments and opens its new
 * tab page instead, so asking would only look like it worked.
 */
export function openChrome(host: ChromeHost): boolean {
  const executable = findChrome(host)
  if (executable === null) return false
  host.start(executable)
  return true
}

export const systemChromeHost: ChromeHost = {
  platform: process.platform,
  env: process.env,
  exists: existsSync,
  start(executable) {
    // Detached and unref'd: Chrome outlives this app, and a piped stdio it
    // never drains would eventually block it.
    const child = spawn(executable, [], { detached: true, stdio: 'ignore' })
    // A binary that is present but refuses to run — quarantined, or on a drive
    // that went away — raises this, and an unhandled 'error' on a child process
    // throws. A browser that failed to start must not take the app with it.
    child.on('error', (error) => console.error('[chrome] failed to start:', error))
    child.unref()
  },
}
