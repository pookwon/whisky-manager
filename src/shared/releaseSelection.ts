import { isReleaseAssetUrl } from './updateSource.js'

export interface UpdateCandidate {
  readonly version: string
  readonly assetName: string
  readonly url: string
  /** Lowercase hex SHA-256 of the file, as GitHub reports it for the asset. */
  readonly sha256: string
  readonly size: number
}

export type ReleaseRejection = 'MALFORMED' | 'NO_ASSET' | 'NO_DIGEST' | 'BAD_URL'

export type ReleaseSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly candidate: UpdateCandidate }
  | { readonly kind: 'rejected'; readonly reason: ReleaseRejection }

/** The file name a release carries for one platform, or null where no installer exists. */
export type AssetNamer = (version: string) => string

/**
 * The names electron-builder's output takes once GitHub has stored it: the
 * Windows file keeps its configured name, while the macOS file's space is
 * stored as a dot.
 */
export function assetNamerFor(platform: string, arch: string): AssetNamer | null {
  if (platform === 'win32') return (version) => `Whisky-Manager-${version}.msi`
  if (platform === 'darwin') return (version) => `Whisky.Manager-${version}-${arch}.dmg`
  return null
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

/** `MAJOR.MINOR.PATCH`, with or without a leading `v`; anything else is not a version. */
export function parseVersion(text: string): readonly [number, number, number] | null {
  const match = VERSION.exec(text)
  if (match === null) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Negative when `a` is older, positive when newer, zero when equal. */
export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

const DIGEST = /^sha256:([0-9a-f]{64})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Decides whether a release response is an update this machine should take.
 *
 * Anything that is not plainly a newer, complete release is refused rather
 * than guessed at: a download with no digest to check is a file nobody can
 * vouch for.
 */
export function selectUpdate(release: unknown, currentVersion: string, assetName: AssetNamer): ReleaseSelection {
  if (!isRecord(release)) return { kind: 'rejected', reason: 'MALFORMED' }
  const { tag_name: tag, draft, prerelease, assets } = release
  if (typeof tag !== 'string' || !Array.isArray(assets)) return { kind: 'rejected', reason: 'MALFORMED' }
  if (draft === true || prerelease === true) return { kind: 'none' }

  const latest = parseVersion(tag)
  const current = parseVersion(currentVersion)
  if (latest === null || current === null) return { kind: 'rejected', reason: 'MALFORMED' }
  if (compareVersions(latest, current) <= 0) return { kind: 'none' }

  const version = latest.join('.')
  const wanted = assetName(version)
  const asset = assets.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry.name === wanted)
  if (asset === undefined) return { kind: 'rejected', reason: 'NO_ASSET' }

  const url = asset.browser_download_url
  if (typeof url !== 'string' || !isReleaseAssetUrl(url)) return { kind: 'rejected', reason: 'BAD_URL' }

  const digest = typeof asset.digest === 'string' ? DIGEST.exec(asset.digest) : null
  if (digest === null || digest[1] === undefined) return { kind: 'rejected', reason: 'NO_DIGEST' }

  const size = asset.size
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return { kind: 'rejected', reason: 'MALFORMED' }

  return { kind: 'available', candidate: { version, assetName: wanted, url, sha256: digest[1], size } }
}
