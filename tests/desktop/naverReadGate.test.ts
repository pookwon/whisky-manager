import { describe, expect, it } from 'vitest'
import { createCollectGate } from '../../src/desktop/collectGate.js'
import { createNaverReadGate } from '../../src/desktop/naverReadGate.js'
import type { AppMessage, ExtensionMessage } from '../../src/shared/protocol.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'

const TIMEOUT_MS = 15_000
const source = { cafeId: '10000000', boardId: '5' }

interface Sent {
  readonly message: AppMessage
  readonly settle: (message: ExtensionMessage) => void
}

function deferredTransport(): { transport: ExtensionTransport; sent: Sent[] } {
  const sent: Sent[] = []
  return {
    sent,
    transport: {
      isConnected: () => true,
      request: (message) => new Promise<ExtensionMessage>((resolve) => sent.push({ message, settle: resolve })),
    },
  }
}

const settleMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const collect = (requestId: string): Extract<AppMessage, { type: 'COLLECT' }> => ({
  type: 'COLLECT', requestId, automationId: 'welcome-comment', source, sincePostedAt: 0,
})
const board = (requestId: string, page: number): Extract<AppMessage, { type: 'COLLECT_BOARD_PAGE' }> => ({
  type: 'COLLECT_BOARD_PAGE', requestId, cafeId: '14538121', menuId: '0', page, pageSize: 50, sortBy: 'TIME', viewType: 'L',
})

describe('createNaverReadGate', () => {
  it('preserves same-range COLLECT joining from the inner collect gate', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createNaverReadGate(createCollectGate(transport))

    const first = gate.request(collect('first'), TIMEOUT_MS)
    const second = gate.request(collect('second'), TIMEOUT_MS)
    await settleMicrotasks()
    expect(sent).toHaveLength(1)

    sent[0]!.settle({ type: 'COLLECTED', requestId: 'first', candidates: [] })
    await expect(Promise.all([first, second])).resolves.toEqual([
      { type: 'COLLECTED', requestId: 'first', candidates: [] },
      { type: 'COLLECTED', requestId: 'first', candidates: [] },
    ])
  })

  it('runs a waiting COLLECT before the next queued board page', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createNaverReadGate(createCollectGate(transport))

    const firstBoard = gate.request(board('board-1', 1), TIMEOUT_MS)
    const secondBoard = gate.request(board('board-2', 2), TIMEOUT_MS)
    await settleMicrotasks()
    expect(sent.map(({ message }) => message.type)).toEqual(['COLLECT_BOARD_PAGE'])

    const waitingCollect = gate.request(collect('collect'), TIMEOUT_MS)
    sent[0]!.settle({ type: 'BOARD_PAGE_COLLECTED', requestId: 'board-1', page: 1, result: { items: [], pageInfo: { lastNavigationPageNumber: 1, visibleNextButton: false, totalArticleCount: 0 }, pageIdentity: 'empty' } })
    await firstBoard
    await settleMicrotasks()
    expect(sent.map(({ message }) => message.type)).toEqual(['COLLECT_BOARD_PAGE', 'COLLECT'])

    sent[1]!.settle({ type: 'COLLECTED', requestId: 'collect', candidates: [] })
    await waitingCollect
    await settleMicrotasks()
    expect(sent.map(({ message }) => message.type)).toEqual(['COLLECT_BOARD_PAGE', 'COLLECT', 'COLLECT_BOARD_PAGE'])

    sent[2]!.settle({ type: 'BOARD_PAGE_COLLECTED', requestId: 'board-2', page: 2, result: { items: [], pageInfo: { lastNavigationPageNumber: 1, visibleNextButton: false, totalArticleCount: 0 }, pageIdentity: 'empty' } })
    await secondBoard
  })

  it('queues a COLLECT_BOARD_SEARCH_PAGE behind an in-flight COLLECT, just like COLLECT_BOARD_PAGE', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createNaverReadGate(createCollectGate(transport))

    const activeCollect = gate.request(collect('collect-1'), TIMEOUT_MS)
    await settleMicrotasks()
    expect(sent).toHaveLength(1)

    const searchPage = gate.request(
      { type: 'COLLECT_BOARD_SEARCH_PAGE', requestId: 'search-1', cafeId: '14538121', menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250828', page: 1, pageSize: 50 },
      TIMEOUT_MS,
    )
    await settleMicrotasks()
    // Search page must not be passed to the inner transport while COLLECT is in flight.
    expect(sent).toHaveLength(1)

    sent[0]!.settle({ type: 'COLLECTED', requestId: 'collect-1', candidates: [] })
    await activeCollect
    await settleMicrotasks()
    expect(sent).toHaveLength(2)
    expect(sent[1]!.message.type).toBe('COLLECT_BOARD_SEARCH_PAGE')

    sent[1]!.settle({ type: 'BOARD_PAGE_COLLECTED', requestId: 'search-1', page: 1, result: { items: [], pageInfo: { lastNavigationPageNumber: 1, visibleNextButton: false, totalArticleCount: 0 }, pageIdentity: 'empty' } })
    await searchPage
  })

  it('does not delay non-read requests behind a board page', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createNaverReadGate(createCollectGate(transport))

    const page = gate.request(board('board', 1), TIMEOUT_MS)
    const comments = gate.request({ type: 'CHECK_COMMENTS', requestId: 'comments', automationId: 'welcome-comment', action: { ...source, postId: '1' } }, TIMEOUT_MS)
    await settleMicrotasks()
    expect(sent.map(({ message }) => message.type)).toEqual(['COLLECT_BOARD_PAGE', 'CHECK_COMMENTS'])

    sent[1]!.settle({ type: 'COMMENTS', requestId: 'comments', authors: [] })
    await comments
    sent[0]!.settle({ type: 'BOARD_PAGE_COLLECTED', requestId: 'board', page: 1, result: { items: [], pageInfo: { lastNavigationPageNumber: 1, visibleNextButton: false, totalArticleCount: 0 }, pageIdentity: 'empty' } })
    await page
  })
  it('queues a COLLECT_ARTICLE behind an in-flight COLLECT, just like the page reads', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createNaverReadGate(createCollectGate(transport))

    const activeCollect = gate.request(collect('collect-1'), TIMEOUT_MS)
    await settleMicrotasks()
    const article = gate.request({ type: 'COLLECT_ARTICLE', requestId: 'article-1', cafeId: '14538121', postId: '728686' }, TIMEOUT_MS)
    await settleMicrotasks()
    expect(sent).toHaveLength(1)

    sent[0]!.settle({ type: 'COLLECTED', requestId: 'collect-1', candidates: [] })
    await activeCollect
    await settleMicrotasks()
    expect(sent).toHaveLength(2)
    expect(sent[1]!.message.type).toBe('COLLECT_ARTICLE')

    sent[1]!.settle({ type: 'ARTICLE_COLLECTED', requestId: 'article-1', result: { kind: 'absent', status: 404, code: '4003' } })
    await article
  })

})
