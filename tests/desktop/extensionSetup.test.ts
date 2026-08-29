import { describe, expect, it } from 'vitest'
import {
  runExtensionRecovery,
  runExtensionSetup,
  type ExtensionSetupPorts,
} from '../../src/desktop/extensionSetup.js'
import { CHROME_EXTENSIONS_URL } from '../../src/shared/chrome.js'

function ports(overrides: Partial<ExtensionSetupPorts> = {}): {
  readonly ports: ExtensionSetupPorts
  readonly order: string[]
  readonly copied: string[]
} {
  const order: string[] = []
  const copied: string[] = []
  return {
    order,
    copied,
    ports: {
      stage: () => {
        order.push('stage')
        return '/data/whisky-manager/chrome-extension'
      },
      reveal: () => order.push('reveal'),
      copyText: (text) => {
        order.push('copy')
        copied.push(text)
      },
      openChrome: () => {
        order.push('chrome')
        return true
      },
      ...overrides,
    },
  }
}

describe('opening everything the first-run guide needs', () => {
  it('answers with the folder it staged', () => {
    const { ports: wired } = ports()

    expect(runExtensionSetup(wired)).toEqual({
      extensionDir: '/data/whisky-manager/chrome-extension',
      chromeOpened: true,
    })
  })

  it('puts the extensions address on the clipboard', () => {
    const { ports: wired, copied } = ports()

    runExtensionSetup(wired)

    expect(copied).toEqual([CHROME_EXTENSIONS_URL])
  })

  /**
   * Chrome last, so it is the window left in front — the operator's next move
   * is in the browser, not in the file manager.
   */
  it('opens the folder before it opens Chrome', () => {
    const { ports: wired, order } = ports()

    runExtensionSetup(wired)

    expect(order).toEqual(['stage', 'reveal', 'copy', 'chrome'])
  })

  it('reports a machine with no Chrome rather than failing the press', () => {
    const { ports: wired } = ports({ openChrome: () => false })

    expect(runExtensionSetup(wired).chromeOpened).toBe(false)
  })

  /**
   * Staging is the only step that can fail, and it goes first for this reason:
   * a build shipped without the extension must leave the machine alone rather
   * than half-arranged, with a clipboard overwritten for nothing.
   */
  it('touches nothing else when there is no extension to stage', () => {
    const { ports: wired, order } = ports({
      stage: () => {
        throw new Error('확장 파일을 찾지 못했습니다')
      },
    })

    expect(() => runExtensionSetup(wired)).toThrow(/확장 파일/)
    expect(order).toEqual([])
  })
})

describe('recovering a missing extension', () => {
  it('stages before resetting, then opens the recovery aids', () => {
    const { ports: wired, order } = ports()

    expect(
      runExtensionRecovery({
        ...wired,
        resetPairing: () => {
          order.push('reset')
          return 'new-token'
        },
      }),
    ).toEqual({
      extensionDir: '/data/whisky-manager/chrome-extension',
      chromeOpened: true,
      pairingToken: 'new-token',
    })
    expect(order).toEqual(['stage', 'reveal', 'copy', 'reset', 'chrome'])
  })

  it('keeps the existing pairing when staging fails', () => {
    const { ports: wired, order } = ports({
      stage: () => {
        throw new Error('확장 파일을 찾지 못했습니다')
      },
    })

    expect(() =>
      runExtensionRecovery({
        ...wired,
        resetPairing: () => {
          order.push('reset')
          return 'new-token'
        },
      }),
    ).toThrow(/확장 파일/)
    expect(order).toEqual([])
  })

  it('keeps the existing pairing when a shell aid fails', () => {
    const { ports: wired, order } = ports({
      reveal: () => {
        order.push('reveal')
        throw new Error('폴더를 열지 못했습니다')
      },
    })

    expect(() =>
      runExtensionRecovery({
        ...wired,
        resetPairing: () => {
          order.push('reset')
          return 'new-token'
        },
      }),
    ).toThrow(/폴더/)
    expect(order).toEqual(['stage', 'reveal'])
  })
})
