import { describe, expect, it } from 'vitest'
import { assetNamerFor, compareVersions, parseVersion, selectUpdate } from '../../src/shared/releaseSelection.js'
import { isAllowedRedirectTarget, isReleaseAssetUrl } from '../../src/shared/updateSource.js'

const HEX = 'a'.repeat(64)
const namer = assetNamerFor('win32', 'x64')!

function release(overrides: Record<string, unknown> = {}, assetOverrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.9.18',
    draft: false,
    prerelease: false,
    assets: [
      { name: 'Whisky-Manager-1.9.17.msi', size: 1, digest: `sha256:${'b'.repeat(64)}`, browser_download_url: 'https://github.com/pookwon/whisky-manager/releases/download/v1.9.17/Whisky-Manager-1.9.17.msi' },
      {
        name: 'Whisky-Manager-1.9.18.msi',
        size: 128_000_000,
        digest: `sha256:${HEX}`,
        browser_download_url: 'https://github.com/pookwon/whisky-manager/releases/download/v1.9.18/Whisky-Manager-1.9.18.msi',
        ...assetOverrides,
      },
    ],
    ...overrides,
  }
}

describe('versions', () => {
  it('reads a tag with or without its v', () => {
    expect(parseVersion('v1.9.18')).toEqual([1, 9, 18])
    expect(parseVersion('1.9.18')).toEqual([1, 9, 18])
  })

  it.each(['1.9', 'v1.9.18-beta', 'latest', '', '1.9.x'])('does not read %j as a version', (text) => {
    expect(parseVersion(text)).toBeNull()
  })

  it('orders by number, not by text', () => {
    expect(compareVersions([1, 9, 18], [1, 9, 9])).toBeGreaterThan(0)
    expect(compareVersions([1, 10, 0], [1, 9, 99])).toBeGreaterThan(0)
    expect(compareVersions([1, 9, 17], [1, 9, 17])).toBe(0)
    expect(compareVersions([1, 9, 16], [1, 9, 17])).toBeLessThan(0)
  })
})

describe('selecting an update', () => {
  it('offers a newer release with its own file and digest', () => {
    expect(selectUpdate(release(), '1.9.17', namer)).toEqual({
      kind: 'available',
      candidate: {
        version: '1.9.18',
        assetName: 'Whisky-Manager-1.9.18.msi',
        url: 'https://github.com/pookwon/whisky-manager/releases/download/v1.9.18/Whisky-Manager-1.9.18.msi',
        sha256: HEX,
        size: 128_000_000,
      },
    })
  })

  it.each(['1.9.18', '1.9.19', '2.0.0'])('offers nothing when this build is %s', (current) => {
    expect(selectUpdate(release(), current, namer)).toEqual({ kind: 'none' })
  })

  it('ignores drafts and prereleases', () => {
    expect(selectUpdate(release({ draft: true }), '1.9.17', namer)).toEqual({ kind: 'none' })
    expect(selectUpdate(release({ prerelease: true }), '1.9.17', namer)).toEqual({ kind: 'none' })
  })

  it('refuses a release with no file for this platform', () => {
    expect(selectUpdate(release({ assets: [] }), '1.9.17', namer)).toEqual({ kind: 'rejected', reason: 'NO_ASSET' })
  })

  it('refuses a file nobody can vouch for', () => {
    expect(selectUpdate(release({}, { digest: null }), '1.9.17', namer)).toEqual({ kind: 'rejected', reason: 'NO_DIGEST' })
    expect(selectUpdate(release({}, { digest: 'md5:abc' }), '1.9.17', namer)).toEqual({ kind: 'rejected', reason: 'NO_DIGEST' })
  })

  it('refuses a download address outside this repository', () => {
    const elsewhere = 'https://github.com/someone/else/releases/download/v1.9.18/Whisky-Manager-1.9.18.msi'
    expect(selectUpdate(release({}, { browser_download_url: elsewhere }), '1.9.17', namer)).toEqual({ kind: 'rejected', reason: 'BAD_URL' })
  })

  it.each([null, 'x', { tag_name: 'v1.9.18' }, { tag_name: 7, assets: [] }])('refuses a malformed response %j', (body) => {
    expect(selectUpdate(body, '1.9.17', namer)).toEqual({ kind: 'rejected', reason: 'MALFORMED' })
  })

  it('names the macOS file the way GitHub stores it', () => {
    expect(assetNamerFor('darwin', 'arm64')!('1.9.18')).toBe('Whisky.Manager-1.9.18-arm64.dmg')
    expect(assetNamerFor('linux', 'x64')).toBeNull()
  })
})

describe('where a download may come from', () => {
  it('accepts only this repository’s release assets', () => {
    expect(isReleaseAssetUrl('https://github.com/pookwon/whisky-manager/releases/download/v1/a.msi')).toBe(true)
    expect(isReleaseAssetUrl('http://github.com/pookwon/whisky-manager/releases/download/v1/a.msi')).toBe(false)
    expect(isReleaseAssetUrl('https://github.com/other/whisky-manager/releases/download/v1/a.msi')).toBe(false)
    expect(isReleaseAssetUrl('https://evil.example/pookwon/whisky-manager/releases/download/v1/a.msi')).toBe(false)
    expect(isReleaseAssetUrl('https://user:pw@github.com/pookwon/whisky-manager/releases/download/v1/a.msi')).toBe(false)
    expect(isReleaseAssetUrl('not a url')).toBe(false)
  })

  it('accepts a redirect only to GitHub’s own hosts', () => {
    expect(isAllowedRedirectTarget('https://release-assets.githubusercontent.com/x')).toBe(true)
    expect(isAllowedRedirectTarget('https://github.com/x')).toBe(true)
    expect(isAllowedRedirectTarget('https://githubusercontent.com.evil.example/x')).toBe(false)
    expect(isAllowedRedirectTarget('https://evilgithubusercontent.com/x')).toBe(false)
    expect(isAllowedRedirectTarget('http://release-assets.githubusercontent.com/x')).toBe(false)
  })
})
