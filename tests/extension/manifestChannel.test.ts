import { describe, expect, it } from 'vitest'
import { applyExtensionChannel, extensionChannel } from '../../src/extension/manifestChannel.js'

const manifest = {
  manifest_version: 3,
  name: 'Whisky Manager Bridge',
  description: 'Bridges the cafe automation desktop app to the logged-in browser session.',
}

describe('extension build channel', () => {
  it('builds what operators install unless development is asked for by name', () => {
    // A typo, an empty value, or nothing at all must never rename the extension
    // the operator already has loaded.
    expect(extensionChannel(undefined)).toBe('release')
    expect(extensionChannel('')).toBe('release')
    expect(extensionChannel('dev')).toBe('release')
    expect(extensionChannel('development')).toBe('development')
    expect(extensionChannel(' Development ')).toBe('development')
  })

  it('leaves the release manifest byte-identical', () => {
    expect(applyExtensionChannel(manifest, 'release')).toEqual(manifest)
  })

  it('marks a development build in front of the name, where Chrome cannot truncate it away', () => {
    const development = applyExtensionChannel(manifest, 'development')

    expect(development.name).toBe('[개발용] Whisky Manager Bridge')
    expect(development.name.startsWith('[개발용]')).toBe(true)
    expect(development.description).toContain('개발용 빌드')
    expect(development.manifest_version).toBe(3)
  })
})
