/**
 * Where updates come from, written once and never read from configuration.
 *
 * The repository is a constant on purpose: a setting, an environment variable
 * or a field in the settings screen would each be a way to point the installer
 * at a stranger's build.
 */
export const UPDATE_REPOSITORY = 'pookwon/whisky-manager'

export const LATEST_RELEASE_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`

const RELEASE_ASSET_HOST = 'github.com'
const RELEASE_ASSET_PATH = `/${UPDATE_REPOSITORY}/releases/download/`
const REDIRECT_HOST_SUFFIX = '.githubusercontent.com'

/** GitHub answers a release download with one redirect; a few spare hops is generous. */
export const MAX_REDIRECT_HOPS = 5

function parseHttps(url: string): URL | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' ? parsed : null
  } catch {
    return null
  }
}

/** Whether `url` is a download of an asset of this repository's releases. */
export function isReleaseAssetUrl(url: string): boolean {
  const parsed = parseHttps(url)
  return parsed !== null && parsed.hostname === RELEASE_ASSET_HOST && parsed.pathname.startsWith(RELEASE_ASSET_PATH)
}

/**
 * Whether a redirect target is a place GitHub serves release files from.
 * Checked at every hop: a redirect the HTTP client follows silently is a
 * redirect nobody validated.
 */
export function isAllowedRedirectTarget(url: string): boolean {
  const parsed = parseHttps(url)
  if (parsed === null) return false
  return parsed.hostname === RELEASE_ASSET_HOST || parsed.hostname.endsWith(REDIRECT_HOST_SUFFIX)
}
