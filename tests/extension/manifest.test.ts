import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../src/extension/manifest.json', import.meta.url)), 'utf8'),
) as { manifest_version: number; permissions: string[]; host_permissions: string[] }

describe('extension manifest', () => {
  it('targets manifest v3', () => {
    expect(manifest.manifest_version).toBe(3)
  })

  it('never requests the cookies permission', () => {
    // Session cookies must never leave the browser. Without this permission the
    // extension physically cannot read them, which is the point.
    expect(manifest.permissions).not.toContain('cookies')
  })

  it('can run the board page telemetry function', () => {
    expect(manifest.permissions).toContain('scripting')
  })

  it('limits host permissions to the cafe origins it needs', () => {
    expect(manifest.host_permissions).toEqual(['https://cafe.naver.com/*', 'https://apis.naver.com/*'])
  })
})
