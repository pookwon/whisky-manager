import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  TIMEOUTS,
  isAppMessage,
  isCollectBoardPageRequest,
  isExtensionMessage,
  isInterimMessage,
} from '../../src/shared/protocol.js'

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
    expect(TIMEOUTS.boardPageMs).toBeLessThan(30_000)
  })

  it('matches the values fixed in the design spec', () => {
    expect(TIMEOUTS.loginCheckMs).toBe(10_000)
    expect(TIMEOUTS.collectMs).toBe(15_000)
    expect(TIMEOUTS.executeMs).toBe(15_000)
    expect(TIMEOUTS.boardPageMs).toBe(20_000)
    expect(TIMEOUTS.extensionReplyMs).toBe(20_000)
  })

  it('bounds the pre-execution comment re-check', () => {
    expect(TIMEOUTS.commentCheckMs).toBe(10_000)
    expect(TIMEOUTS.commentCheckMs).toBeLessThan(30_000)
  })
})

describe('board page messages', () => {
  const request = {
    type: 'COLLECT_BOARD_PAGE' as const,
    requestId: 'board-1',
    cafeId: '14538121' as const,
    menuId: '0' as const,
    page: 1,
    pageSize: 50 as const,
    sortBy: 'TIME' as const,
    viewType: 'L' as const,
  }

  it('accepts only the fixed cafe, 50-row, TIME/L request contract', () => {
    expect(isAppMessage(request)).toBe(true)
    expect(isAppMessage({ ...request, page: 0 })).toBe(false)
    expect(isAppMessage({ ...request, cafeId: 'other' })).toBe(false)
    expect(isAppMessage({ ...request, pageSize: 20 })).toBe(false)
  })

  it('accepts any numeric menu on a board page request and refuses anything else', () => {
    const base = { type: 'COLLECT_BOARD_PAGE' as const, requestId: 'r', cafeId: '14538121', page: 1, pageSize: 50, sortBy: 'TIME' as const, viewType: 'L' as const }
    expect(isCollectBoardPageRequest({ ...base, menuId: '137' })).toBe(true)
    expect(isCollectBoardPageRequest({ ...base, menuId: '0' })).toBe(true)
    expect(isCollectBoardPageRequest({ ...base, menuId: '' })).toBe(false)
    expect(isCollectBoardPageRequest({ ...base, menuId: '13a' })).toBe(false)
    expect(isCollectBoardPageRequest({ ...base, menuId: 137 })).toBe(false)
  })

  it('recognises a structurally valid parsed board-page reply', () => {
    expect(
      isExtensionMessage({
        type: 'BOARD_PAGE_COLLECTED', requestId: 'board-1', page: 1,
        result: { items: [], pageInfo: { lastNavigationPageNumber: 1, visibleNextButton: false, totalArticleCount: 0 }, pageIdentity: 'empty' },
      }),
    ).toBe(true)
  })

  it('accepts a board-page reply whose list carries no total, as a board\'s own list does', () => {
    expect(
      isExtensionMessage({
        type: 'BOARD_PAGE_COLLECTED', requestId: 'board-2', page: 1,
        result: { items: [], pageInfo: { lastNavigationPageNumber: 1, visibleNextButton: false, totalArticleCount: null }, pageIdentity: 'empty' },
      }),
    ).toBe(true)
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

  it('accepts a PROBE_RESULT reply', () => {
    expect(
      isExtensionMessage({
        type: 'PROBE_RESULT',
        requestId: 'r10',
        status: 200,
        contentType: 'text/html;charset=MS949',
        text: '<html></html>',
        error: null,
      }),
    ).toBe(true)
  })
})

describe('probe messages', () => {
  it('recognises PROBE as an app message', () => {
    expect(isAppMessage({ type: 'PROBE', requestId: 'r10', url: 'https://cafe.naver.com/x' })).toBe(true)
  })

  it('keeps the two directions separate', () => {
    expect(isExtensionMessage({ type: 'PROBE', requestId: 'r10', url: 'https://cafe.naver.com/x' })).toBe(false)
    expect(isAppMessage({ type: 'PROBE_RESULT', requestId: 'r10' })).toBe(false)
  })
})

describe('keepalive messages', () => {
  it('recognises PING as an extension message', () => {
    expect(isExtensionMessage({ type: 'PING', requestId: null })).toBe(true)
  })

  it('keeps the keepalive one-directional', () => {
    // Only the extension has a worker Chrome can tear down, so only the
    // extension has a reason to speak into an idle socket.
    expect(isAppMessage({ type: 'PING', requestId: null })).toBe(false)
  })

  it('never ends a request in flight', () => {
    // A keepalive that counted as interim would refresh a timeout the extension
    // is no longer working on, and hide a stalled request for as long as it ran.
    expect(isInterimMessage({ type: 'PING', requestId: null })).toBe(false)
  })
})

describe('collection progress messages', () => {
  it('accepts a COLLECT_PROGRESS interim message', () => {
    expect(
      isExtensionMessage({
        type: 'COLLECT_PROGRESS',
        requestId: 'r11',
        pagesRead: 2,
        collected: 87,
      }),
    ).toBe(true)
  })

  it('keeps app and extension sides separate', () => {
    expect(isAppMessage({ type: 'COLLECT_PROGRESS', requestId: 'r11' })).toBe(false)
  })
})


describe('isInterimMessage', () => {
  it('knows the reply that reports on a request still running', () => {
    expect(
      isInterimMessage({ type: 'COLLECT_PROGRESS', requestId: 'r1', pagesRead: 2, collected: 87 }),
    ).toBe(true)
  })

  it('leaves every reply that ends a request to the caller', () => {
    // Anything answered here would end its request the moment it arrived, which
    // for COLLECTED is the difference between a day's posts and none.
    expect(isInterimMessage({ type: 'COLLECTED', requestId: 'r1', candidates: [] })).toBe(false)
    expect(isInterimMessage({ type: 'COMMENTS', requestId: 'r1', authors: [] })).toBe(false)
    expect(
      isInterimMessage({ type: 'LOGIN_STATE', requestId: 'r1', loggedIn: true, account: 'a' }),
    ).toBe(false)
    expect(
      isInterimMessage({ type: 'ERROR', requestId: 'r1', code: 'X', message: 'boom' }),
    ).toBe(false)
  })
})
