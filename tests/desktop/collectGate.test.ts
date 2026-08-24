import { describe, expect, it, vi } from 'vitest'
import { createCollectGate } from '../../src/desktop/collectGate.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'

const SOURCE = { cafeId: '10000000', boardId: '5' }
const AUTOMATION_ID = 'welcome-comment'
const TIMEOUT_MS = 15_000
const DAY_MS = 86_400_000
const TODAY = 1_787_500_800_000

function collectMessage(requestId: string, sincePostedAt: number): AppMessage {
  return { type: 'COLLECT', requestId, automationId: AUTOMATION_ID, source: SOURCE, sincePostedAt }
}

function post(postId: string): RawCandidate {
  return {
    postId,
    title: null,
    bodyText: null,
    authorNickname: null,
    authorId: null,
    postedAt: TODAY,
    commentCount: 0,
  }
}

function collected(requestId: string, ...postIds: string[]): ExtensionMessage {
  return { type: 'COLLECTED', requestId, candidates: postIds.map(post) }
}

interface Sent {
  readonly message: AppMessage
  readonly onInterim: ((message: ExtensionMessage) => void) | undefined
  readonly settle: (reply: ExtensionMessage) => void
  readonly fail: (error: Error) => void
}

/** A transport whose walks finish only when the test says so. */
function deferredTransport(): { transport: ExtensionTransport; sent: Sent[] } {
  const sent: Sent[] = []
  const transport: ExtensionTransport = {
    isConnected: () => true,
    request: (message, _timeoutMs, onInterim) =>
      new Promise<ExtensionMessage>((resolve, reject) => {
        sent.push({ message, onInterim, settle: resolve, fail: reject })
      }),
  }
  return { transport, sent }
}

/** Lets every already-resolved continuation run. */
const settleMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createCollectGate', () => {
  it('shares one walk between callers asking for the same range', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createCollectGate(transport)

    const first = gate.request(collectMessage('a', TODAY), TIMEOUT_MS)
    const second = gate.request(collectMessage('b', TODAY), TIMEOUT_MS)
    await settleMicrotasks()

    expect(sent).toHaveLength(1)

    sent[0]!.settle(collected('a', '100', '101'))

    expect(await first).toEqual(collected('a', '100', '101'))
    expect(await second).toEqual(collected('a', '100', '101'))
  })

  it('holds a walk over another range until the one in flight finishes', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createCollectGate(transport)

    const today = gate.request(collectMessage('a', TODAY), TIMEOUT_MS)
    const yesterday = gate.request(collectMessage('b', TODAY - DAY_MS), TIMEOUT_MS)
    await settleMicrotasks()

    expect(sent).toHaveLength(1)

    sent[0]!.settle(collected('a', '100'))
    await today
    await settleMicrotasks()

    expect(sent).toHaveLength(2)
    expect(sent[1]!.message).toMatchObject({ type: 'COLLECT', sincePostedAt: TODAY - DAY_MS })

    sent[1]!.settle(collected('b', '90'))
    expect(await yesterday).toEqual(collected('b', '90'))
  })

  it('reports progress to every caller sharing the walk', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createCollectGate(transport)
    const onFirst = vi.fn()
    const onSecond = vi.fn()

    const first = gate.request(collectMessage('a', TODAY), TIMEOUT_MS, onFirst)
    const second = gate.request(collectMessage('b', TODAY), TIMEOUT_MS, onSecond)
    await settleMicrotasks()

    const progress: ExtensionMessage = {
      type: 'COLLECT_PROGRESS',
      requestId: 'a',
      pagesRead: 2,
      collected: 40,
    }
    sent[0]!.onInterim?.(progress)

    expect(onFirst).toHaveBeenCalledWith(progress)
    expect(onSecond).toHaveBeenCalledWith(progress)

    sent[0]!.settle(collected('a', '100'))
    await Promise.all([first, second])
  })

  it('walks again for a range it has already walked', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createCollectGate(transport)

    const first = gate.request(collectMessage('a', TODAY), TIMEOUT_MS)
    await settleMicrotasks()
    sent[0]!.settle(collected('a', '100'))
    await first

    const second = gate.request(collectMessage('b', TODAY), TIMEOUT_MS)
    await settleMicrotasks()

    expect(sent).toHaveLength(2)

    sent[1]!.settle(collected('b', '100', '101'))
    expect(await second).toEqual(collected('b', '100', '101'))
  })

  it('lets the next walk start after one fails', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createCollectGate(transport)

    const failing = gate.request(collectMessage('a', TODAY), TIMEOUT_MS)
    const next = gate.request(collectMessage('b', TODAY - DAY_MS), TIMEOUT_MS)
    await settleMicrotasks()

    sent[0]!.fail(new Error('timeout'))
    await expect(failing).rejects.toThrow('timeout')
    await settleMicrotasks()

    expect(sent).toHaveLength(2)

    sent[1]!.settle(collected('b', '90'))
    expect(await next).toEqual(collected('b', '90'))
  })

  it('carries the failure to every caller sharing the walk', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createCollectGate(transport)

    const first = gate.request(collectMessage('a', TODAY), TIMEOUT_MS)
    const second = gate.request(collectMessage('b', TODAY), TIMEOUT_MS)
    await settleMicrotasks()

    sent[0]!.fail(new Error('timeout'))

    await expect(first).rejects.toThrow('timeout')
    await expect(second).rejects.toThrow('timeout')
  })

  it('does not hold other requests behind a walk', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createCollectGate(transport)

    const walk = gate.request(collectMessage('a', TODAY), TIMEOUT_MS)
    const comments = gate.request(
      { type: 'CHECK_COMMENTS', requestId: 'b', automationId: AUTOMATION_ID, action: { ...SOURCE, postId: '100' } },
      TIMEOUT_MS,
    )
    await settleMicrotasks()

    expect(sent).toHaveLength(2)
    expect(sent[1]!.message).toMatchObject({ type: 'CHECK_COMMENTS' })

    sent[1]!.settle({ type: 'COMMENTS', requestId: 'b', authors: [] })
    expect(await comments).toMatchObject({ type: 'COMMENTS' })

    sent[0]!.settle(collected('a', '100'))
    await walk
  })
})
