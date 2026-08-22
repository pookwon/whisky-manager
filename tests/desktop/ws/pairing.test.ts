import { describe, expect, it } from 'vitest'
import { extensionIdFromOrigin, generateToken, verifyHello } from '../../../src/desktop/ws/pairing.js'
import { PROTOCOL_VERSION } from '../../../src/shared/protocol.js'

const TOKEN = 'correct-horse-battery-staple'
const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'
const ORIGIN = `chrome-extension://${EXT_ID}`

function attempt(overrides: Partial<Parameters<typeof verifyHello>[1]> = {}) {
  return { token: TOKEN, origin: ORIGIN, protocolVersion: PROTOCOL_VERSION, ...overrides }
}

describe('generateToken', () => {
  it('produces a long, url-safe, non-repeating token', () => {
    const a = generateToken()
    expect(a).not.toBe(generateToken())
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('extensionIdFromOrigin', () => {
  it('extracts the id from a chrome-extension origin', () => {
    expect(extensionIdFromOrigin(ORIGIN)).toBe(EXT_ID)
  })

  it('rejects any other scheme', () => {
    expect(extensionIdFromOrigin('https://cafe.naver.com')).toBeNull()
    expect(extensionIdFromOrigin(undefined)).toBeNull()
  })
})

describe('verifyHello — trust on first use', () => {
  it('accepts and binds the first extension presenting the right token', () => {
    expect(verifyHello({ token: TOKEN, boundExtensionId: null }, attempt())).toEqual({
      accepted: true,
      boundExtensionId: EXT_ID,
    })
  })

  it('accepts the bound extension on later connections', () => {
    expect(verifyHello({ token: TOKEN, boundExtensionId: EXT_ID }, attempt())).toEqual({
      accepted: true,
      boundExtensionId: EXT_ID,
    })
  })

  it('rejects a different extension even with the right token', () => {
    const other = 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
    expect(verifyHello({ token: TOKEN, boundExtensionId: EXT_ID }, attempt({ origin: other }))).toEqual({
      accepted: false,
      reason: 'WRONG_EXTENSION',
    })
  })

  it('rejects a wrong token', () => {
    expect(verifyHello({ token: TOKEN, boundExtensionId: null }, attempt({ token: 'nope' }))).toEqual({
      accepted: false,
      reason: 'BAD_TOKEN',
    })
  })

  it('rejects a non-extension origin', () => {
    expect(verifyHello({ token: TOKEN, boundExtensionId: null }, attempt({ origin: 'https://evil.example' }))).toEqual(
      { accepted: false, reason: 'BAD_ORIGIN' },
    )
  })

  it('rejects a mismatched protocol version', () => {
    expect(
      verifyHello({ token: TOKEN, boundExtensionId: null }, attempt({ protocolVersion: PROTOCOL_VERSION + 1 })),
    ).toEqual({ accepted: false, reason: 'PROTOCOL_MISMATCH' })
  })
})
