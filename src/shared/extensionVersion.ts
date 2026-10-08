import { TEXT } from './text.js'

/**
 * The warning to show beside a connected extension whose build is not the
 * app's, or null when the two match. Compared as strings: the manifest and the
 * package carry the same version, and anything else is a mismatch to say.
 *
 * Absent (`null`) means the extension predates sending a version at all,
 * which can only be older than this app.
 */
export function extensionVersionWarning(appVersion: string, extensionVersion: string | null): string | null {
  if (extensionVersion === null) return TEXT.status.extensionVersionUnknown(appVersion)
  return extensionVersion === appVersion ? null : TEXT.status.extensionVersionMismatch(extensionVersion, appVersion)
}
