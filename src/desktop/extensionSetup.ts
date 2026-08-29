import { CHROME_EXTENSIONS_URL } from '../shared/chrome.js'

/** The four things the setup does, each of which belongs to the shell. */
export interface ExtensionSetupPorts {
  /** Puts the bundled extension on disk and answers with its folder. */
  readonly stage: () => string
  /** Shows that folder in Finder or Explorer. */
  readonly reveal: (directory: string) => void
  readonly copyText: (text: string) => void
  /** Starts Chrome; false when no Chrome could be found on this machine. */
  readonly openChrome: () => boolean
}

export interface ExtensionRecoveryPorts extends ExtensionSetupPorts {
  /** Rotates the token and forgets the id that belonged to the missing installation. */
  readonly resetPairing: () => string
}

export interface ExtensionSetupResult {
  /** Where the extension now is, so the operator can read and copy the path. */
  readonly extensionDir: string
  /** False when Chrome is not installed, which the guide has to say out loud. */
  readonly chromeOpened: boolean
}

export interface ExtensionRecoveryResult extends ExtensionSetupResult {
  /** The newly rotated token the replacement extension must save. */
  readonly pairingToken: string
}

/**
 * Everything the operator needs, opened in one press.
 *
 * The order is the order they are used in. Staging comes first because it is
 * the only step that can fail, and a failure there must leave the machine
 * untouched rather than half-arranged. Chrome comes last so that it, and not
 * the file manager, is the window left in front.
 */
export function runExtensionSetup(ports: ExtensionSetupPorts): ExtensionSetupResult {
  const extensionDir = ports.stage()
  ports.reveal(extensionDir)
  ports.copyText(CHROME_EXTENSIONS_URL)
  return { extensionDir, chromeOpened: ports.openChrome() }
}

/**
 * Replaces a missing extension without leaving a working pairing half-reset.
 * Every failure-prone aid is prepared before trust changes: a missing bundle,
 * Finder failure or clipboard failure leaves the old pairing intact. The reset
 * still precedes Chrome, so the replacement can bind as soon as it is loaded.
 */
export function runExtensionRecovery(ports: ExtensionRecoveryPorts): ExtensionRecoveryResult {
  const extensionDir = ports.stage()
  ports.reveal(extensionDir)
  ports.copyText(CHROME_EXTENSIONS_URL)
  const pairingToken = ports.resetPairing()
  return { extensionDir, chromeOpened: ports.openChrome(), pairingToken }
}
