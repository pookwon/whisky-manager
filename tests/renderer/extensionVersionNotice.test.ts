import { describe, expect, it } from 'vitest'
import { extensionVersionNotice } from '../../src/renderer/extensionVersionNotice.js'
import { TEXT } from '../../src/shared/text.js'

describe('extensionVersionNotice', () => {
  it('warns only about an extension that is connected', () => {
    expect(extensionVersionNotice({ bridgeStatus: 'CONNECTED', appVersion: '1.9.15', extensionVersion: '1.9.12' })).toBe(
      TEXT.status.extensionVersionMismatch('1.9.12', '1.9.15'),
    )
    expect(extensionVersionNotice({ bridgeStatus: 'CONNECTED', appVersion: '1.9.15', extensionVersion: null })).toBe(
      TEXT.status.extensionVersionUnknown('1.9.15'),
    )
    expect(extensionVersionNotice({ bridgeStatus: 'CONNECTED', appVersion: '1.9.15', extensionVersion: '1.9.15' })).toBeNull()
  })

  it('says nothing while the extension is away, whatever it last said', () => {
    expect(extensionVersionNotice({ bridgeStatus: 'RECONNECTING', appVersion: '1.9.15', extensionVersion: null })).toBeNull()
    expect(extensionVersionNotice({ bridgeStatus: 'OFFLINE', appVersion: '1.9.15', extensionVersion: '1.9.12' })).toBeNull()
  })
})
