import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, TIMEOUTS, isAppMessage, isExtensionMessage } from '../../src/shared/protocol.js'

describe('protocol version', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true)
    expect(PROTOCOL_VERSION).toBeGreaterThan(0)
  })
})

describe('timeouts', () => {
  it('keeps every fetch-bearing timeout under the MV3 service worker limit', () => {
    // A service worker is torn down when a fetch takes longer than 30s.
    expect(TIMEOUTS.loginCheckMs).toBeLessThan(30_000)
    expect(TIMEOUTS.collectMs).toBeLessThan(30_000)
    expect(TIMEOUTS.executeMs).toBeLessThan(30_000)
  })

  it('matches the values fixed in the design spec', () => {
    expect(TIMEOUTS.loginCheckMs).toBe(10_000)
    expect(TIMEOUTS.collectMs).toBe(15_000)
    expect(TIMEOUTS.executeMs).toBe(15_000)
    expect(TIMEOUTS.extensionReplyMs).toBe(20_000)
  })

  it('bounds the pre-execution comment re-check', () => {
    expect(TIMEOUTS.commentCheckMs).toBe(10_000)
    expect(TIMEOUTS.commentCheckMs).toBeLessThan(30_000)
  })
})

describe('isAppMessage', () => {
  it('accepts a well-formed EXECUTE message', () => {
    expect(
      isAppMessage({
        type: 'EXECUTE',
        requestId: 'r1',
        automationId: 'welcome-comment',
        action: { cafeId: '10000000', boardId: '5', postId: '1001', body: 'hello' },
      }),
    ).toBe(true)
  })

  it('rejects an unknown type', () => {
    expect(isAppMessage({ type: 'NOPE', requestId: 'r1' })).toBe(false)
  })

  it('accepts a CHECK_COMMENTS message', () => {
    expect(
      isAppMessage({
        type: 'CHECK_COMMENTS',
        requestId: 'r9',
        automationId: 'welcome-comment',
        action: { cafeId: '10000000', boardId: '5', postId: '1001' },
      }),
    ).toBe(true)
  })

  it('rejects a non-object', () => {
    expect(isAppMessage('EXECUTE')).toBe(false)
    expect(isAppMessage(null)).toBe(false)
  })
})

describe('isExtensionMessage', () => {
  it('accepts a HELLO handshake', () => {
    expect(
      isExtensionMessage({ type: 'HELLO', token: 't', extensionId: 'abc', protocolVersion: PROTOCOL_VERSION }),
    ).toBe(true)
  })

  it('accepts a COMMENTS reply', () => {
    expect(isExtensionMessage({ type: 'COMMENTS', requestId: 'r9', authors: ['cafe-ops'] })).toBe(true)
  })

  it('rejects an app-side type', () => {
    expect(isExtensionMessage({ type: 'EXECUTE', requestId: 'r1' })).toBe(false)
  })
})
