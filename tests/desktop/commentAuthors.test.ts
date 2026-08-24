import { describe, expect, it } from 'vitest'
import { createCommentAuthorLookup } from '../../src/desktop/commentAuthors.js'
import type { CommentAuthor } from '../../src/shared/types.js'
import type { AppMessage, ExtensionMessage } from '../../src/shared/protocol.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'
import { SequenceRandom } from '../fakes.js'

const CAFE_ID = '10000000'
const BOARD_ID = '5'
const AUTOMATION_ID = 'welcome-comment'

interface FakeTransportOptions {
  responses?: Record<string, Extract<ExtensionMessage, { type: 'COMMENTS' }>>
  shouldFail?: boolean
}

class FakeTransport implements ExtensionTransport {
  private requestCount = 0
  public recordedRequests: AppMessage[] = []
  private options: FakeTransportOptions

  constructor(options: FakeTransportOptions = {}) {
    this.options = options
  }

  isConnected(): boolean {
    return true
  }

  async request(message: AppMessage, _timeoutMs: number): Promise<ExtensionMessage> {
    this.recordedRequests.push(message)
    this.requestCount += 1

    if (this.options.shouldFail) {
      throw new Error('Transport failed')
    }

    if (message.type === 'CHECK_COMMENTS') {
      const postId = message.action.postId
      if (this.options.responses?.[postId]) {
        return this.options.responses[postId]
      }

      // Default response: empty authors list
      return {
        type: 'COMMENTS',
        requestId: message.requestId,
        authors: [],
      } as Extract<ExtensionMessage, { type: 'COMMENTS' }>
    }

    // Fallback for non-CHECK_COMMENTS messages
    const requestId = (message as { requestId?: string }).requestId ?? 'unknown'
    return { type: 'COMMENTS', requestId, authors: [] } as Extract<
      ExtensionMessage,
      { type: 'COMMENTS' }
    >
  }

  getRequestCount(): number {
    return this.requestCount
  }
}

describe('createCommentAuthorLookup', () => {
  let sleepCalls: number[] = []

  async function sleep(ms: number): Promise<void> {
    sleepCalls.push(ms)
  }

  function resetSleep(): void {
    sleepCalls = []
  }

  it('does not make a request when commentCount is 0', async () => {
    const transport = new FakeTransport()
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_000]),
      sleep,
    })

    resetSleep()
    const result = await lookup.resolve('1001', 0)

    expect(result).toEqual([])
    expect(transport.getRequestCount()).toBe(0)
  })

  it('does not make a request when commentCount is null', async () => {
    const transport = new FakeTransport()
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_000]),
      sleep,
    })

    resetSleep()
    const result = await lookup.resolve('1002', null)

    expect(result).toBeNull()
    expect(transport.getRequestCount()).toBe(0)
  })

  it('makes a request when commentCount is greater than 0', async () => {
    const authors: CommentAuthor[] = [
      { nickname: 'user1', memberKey: 'key1' },
      { nickname: 'user2', memberKey: 'key2' },
    ]
    const transport = new FakeTransport({
      responses: {
        '1003': {
          type: 'COMMENTS',
          requestId: 'req-1',
          authors,
        } as Extract<ExtensionMessage, { type: 'COMMENTS' }>,
      },
    })
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_000]),
      sleep,
    })

    resetSleep()
    const result = await lookup.resolve('1003', 2)

    expect(result).toEqual(authors)
    expect(transport.getRequestCount()).toBe(1)
  })

  it('remembers the result of a successful lookup and does not request again', async () => {
    const authors: CommentAuthor[] = [
      { nickname: 'user1', memberKey: 'key1' },
    ]
    const transport = new FakeTransport({
      responses: {
        '1004': {
          type: 'COMMENTS',
          requestId: 'req-1',
          authors,
        } as Extract<ExtensionMessage, { type: 'COMMENTS' }>,
      },
    })
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_000]),
      sleep,
    })

    resetSleep()
    // First call
    const result1 = await lookup.resolve('1004', 1)
    expect(result1).toEqual(authors)
    expect(transport.getRequestCount()).toBe(1)

    // Second call should use cache
    const result2 = await lookup.resolve('1004', 1)
    expect(result2).toEqual(authors)
    expect(transport.getRequestCount()).toBe(1) // Still 1, not 2
  })

  it('does not remember a failed lookup (authors is null) and retries on next call', async () => {
    const transport = new FakeTransport({
      responses: {
        '1005': {
          type: 'COMMENTS',
          requestId: 'req-1',
          authors: null,
        } as Extract<ExtensionMessage, { type: 'COMMENTS' }>,
      },
    })
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_000]),
      sleep,
    })

    resetSleep()
    // First call returns null
    const result1 = await lookup.resolve('1005', 1)
    expect(result1).toBeNull()
    expect(transport.getRequestCount()).toBe(1)

    // Second call should retry because the failure wasn't remembered
    const result2 = await lookup.resolve('1005', 1)
    expect(result2).toBeNull()
    expect(transport.getRequestCount()).toBe(2)
  })

  it('does not remember a lookup that threw an exception and retries on next call', async () => {
    const transport = new FakeTransport({ shouldFail: true })
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_000]),
      sleep,
    })

    resetSleep()
    // First call throws
    const result1 = await lookup.resolve('1006', 1)
    expect(result1).toBeNull()
    expect(transport.getRequestCount()).toBe(1)

    // Second call should retry because the failure wasn't remembered
    const result2 = await lookup.resolve('1006', 1)
    expect(result2).toBeNull()
    expect(transport.getRequestCount()).toBe(2)
  })

  it('calls sleep before making a request', async () => {
    const authors: CommentAuthor[] = [
      { nickname: 'user1', memberKey: 'key1' },
    ]
    const transport = new FakeTransport({
      responses: {
        '1007': {
          type: 'COMMENTS',
          requestId: 'req-1',
          authors,
        } as Extract<ExtensionMessage, { type: 'COMMENTS' }>,
      },
    })
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_250]),
      sleep,
    })

    resetSleep()
    await lookup.resolve('1007', 1)

    expect(sleepCalls).toHaveLength(1)
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(1_000)
    expect(sleepCalls[0]).toBeLessThanOrEqual(1_500)
  })

  it('calls sleep with a delay in the expected range', async () => {
    const authors: CommentAuthor[] = [
      { nickname: 'user1', memberKey: 'key1' },
    ]
    const transport = new FakeTransport({
      responses: {
        '1008': {
          type: 'COMMENTS',
          requestId: 'req-1',
          authors,
        } as Extract<ExtensionMessage, { type: 'COMMENTS' }>,
      },
    })
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_200]),
      sleep,
    })

    resetSleep()
    await lookup.resolve('1008', 1)

    expect(sleepCalls[0]).toBe(1_200)
  })

  it('sends the correct CHECK_COMMENTS request', async () => {
    const authors: CommentAuthor[] = []
    const transport = new FakeTransport({
      responses: {
        '1009': {
          type: 'COMMENTS',
          requestId: 'req-abc',
          authors,
        } as Extract<ExtensionMessage, { type: 'COMMENTS' }>,
      },
    })
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-abc',
      random: new SequenceRandom([1_000]),
      sleep,
    })

    resetSleep()
    await lookup.resolve('1009', 1)

    expect(transport.recordedRequests).toHaveLength(1)
    const request = transport.recordedRequests[0]
    expect(request).toBeDefined()
    if (!request) return

    expect(request.type).toBe('CHECK_COMMENTS')
    if (request.type === 'CHECK_COMMENTS') {
      expect(request.automationId).toBe(AUTOMATION_ID)
      expect(request.action.cafeId).toBe(CAFE_ID)
      expect(request.action.boardId).toBe(BOARD_ID)
      expect(request.action.postId).toBe('1009')
    }
  })

  it('waits on in-flight request when two concurrent calls ask about the same post', async () => {
    const authors: CommentAuthor[] = [
      { nickname: 'user1', memberKey: 'key1' },
    ]
    const transport = new FakeTransport({
      responses: {
        '1010': {
          type: 'COMMENTS',
          requestId: 'req-1',
          authors,
        } as Extract<ExtensionMessage, { type: 'COMMENTS' }>,
      },
    })
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_000]),
      sleep,
    })

    resetSleep()
    // Start two resolves without awaiting the first
    const promise1 = lookup.resolve('1010', 1)
    const promise2 = lookup.resolve('1010', 1)

    // Both should resolve to the same authors
    const result1 = await promise1
    const result2 = await promise2
    expect(result1).toEqual(authors)
    expect(result2).toEqual(authors)

    // Only one request should have been sent (not two)
    expect(transport.getRequestCount()).toBe(1)
  })

  it('does not cache failed lookups under concurrent calls and retries on next ask', async () => {
    const transport = new FakeTransport({
      responses: {
        '1011': {
          type: 'COMMENTS',
          requestId: 'req-1',
          authors: null,
        } as Extract<ExtensionMessage, { type: 'COMMENTS' }>,
      },
    })
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE_ID,
      boardId: BOARD_ID,
      automationId: AUTOMATION_ID,
      newRequestId: () => 'req-1',
      random: new SequenceRandom([1_000]),
      sleep,
    })

    resetSleep()
    // Start two concurrent resolves that both hit null authors
    const promise1 = lookup.resolve('1011', 1)
    const promise2 = lookup.resolve('1011', 1)

    const result1 = await promise1
    const result2 = await promise2
    expect(result1).toBeNull()
    expect(result2).toBeNull()

    // Both concurrent asks sent the same request (only 1 total)
    expect(transport.getRequestCount()).toBe(1)

    // A third ask should send a fresh request because the failure was not cached
    resetSleep()
    const result3 = await lookup.resolve('1011', 1)
    expect(result3).toBeNull()
    expect(transport.getRequestCount()).toBe(2)
  })
})
