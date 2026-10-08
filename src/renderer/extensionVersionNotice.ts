import { extensionVersionWarning } from '../shared/extensionVersion.js'
import type { DashboardSnapshot } from '../desktop/ipc.js'

/**
 * The version warning for the places that show the bridge status. Only a
 * connected extension has a version to read against the app's; while it is
 * away the status line already says so, and a warning would be about nobody.
 */
export function extensionVersionNotice(
  snapshot: Pick<DashboardSnapshot, 'bridgeStatus' | 'appVersion' | 'extensionVersion'>,
): string | null {
  if (snapshot.bridgeStatus !== 'CONNECTED') return null
  return extensionVersionWarning(snapshot.appVersion, snapshot.extensionVersion)
}
