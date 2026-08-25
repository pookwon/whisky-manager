import { describe, expect, it } from 'vitest'
import {
  chromeCandidates,
  findChrome,
  openChrome,
  type ChromeHost,
} from '../../src/desktop/chromeLauncher.js'

const WINDOWS_ENV = {
  LOCALAPPDATA: 'C:\\Users\\운영\\AppData\\Local',
  PROGRAMFILES: 'C:\\Program Files',
  'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
}

const PER_USER = 'C:\\Users\\운영\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const MACHINE_WIDE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

interface HostOptions {
  readonly platform: NodeJS.Platform
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly installed?: readonly string[]
}

function host(options: HostOptions): { readonly host: ChromeHost; readonly started: string[] } {
  const started: string[] = []
  return {
    started,
    host: {
      platform: options.platform,
      env: options.env ?? {},
      exists: (path) => (options.installed ?? []).includes(path),
      start: (executable) => {
        started.push(executable)
      },
    },
  }
}

describe('where Chrome is looked for', () => {
  /**
   * The operators run Windows; only development happens on a Mac. This order is
   * the one that decides whether the feature works for them at all.
   */
  it('asks about the per-user install before the machine-wide one on Windows', () => {
    expect(chromeCandidates('win32', WINDOWS_ENV)).toEqual([
      PER_USER,
      MACHINE_WIDE,
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ])
  })

  it('leaves out a Windows root the environment does not set', () => {
    expect(chromeCandidates('win32', { PROGRAMFILES: 'C:\\Program Files' })).toEqual([MACHINE_WIDE])
  })

  it('covers both places macOS puts an application', () => {
    expect(chromeCandidates('darwin', { HOME: '/Users/dev' })).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/dev/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ])
  })

  it('drops the per-user path on macOS when there is no home to build it from', () => {
    expect(chromeCandidates('darwin', {})).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ])
  })

  it('falls back to the usual unix binaries elsewhere', () => {
    expect(chromeCandidates('linux', {})).toContain('/usr/bin/google-chrome')
  })

  it('answers with the first install actually on disk', () => {
    const { host: found } = host({
      platform: 'win32',
      env: WINDOWS_ENV,
      installed: [MACHINE_WIDE],
    })

    expect(findChrome(found)).toBe(MACHINE_WIDE)
  })

  it('answers null when none of them is there', () => {
    const { host: bare } = host({ platform: 'win32', env: WINDOWS_ENV })

    expect(findChrome(bare)).toBeNull()
  })
})

describe('starting Chrome', () => {
  it('starts the install it found and says so', () => {
    const { host: found, started } = host({
      platform: 'win32',
      env: WINDOWS_ENV,
      installed: [PER_USER, MACHINE_WIDE],
    })

    expect(openChrome(found)).toBe(true)
    expect(started).toEqual([PER_USER])
  })

  /**
   * Reported rather than thrown. The folder and the clipboard still help an
   * operator who has Chrome somewhere this does not know about, and the guide
   * says as much instead of failing the whole press.
   */
  it('reports a machine with no Chrome without starting anything', () => {
    const { host: bare, started } = host({ platform: 'win32', env: WINDOWS_ENV })

    expect(openChrome(bare)).toBe(false)
    expect(started).toEqual([])
  })
})
