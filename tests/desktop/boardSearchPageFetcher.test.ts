import { describe, expect, it } from 'vitest'
import { createBoardSearchPageFetcher } from '../../src/desktop/boardSearchPageFetcher.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { AppMessage, ExtensionMessage } from '../../src/shared/protocol.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'

const page = { menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250828', page: 4 }
const empty = { items: [], pageInfo: { totalArticleCount: 0, lastNavigationPageNumber: 1, visibleNextButton: false }, pageIdentity: 'fnv1a64:0' }

function transportAnswering(reply: (message: AppMessage) => ExtensionMessage, sent: AppMessage[]): ExtensionTransport {
  return {
    isConnected: () => true,
    request: async (message: AppMessage) => {
      sent.push(message)
      return reply(message)
    },
  } as unknown as ExtensionTransport
}

describe('createBoardSearchPageFetcher', () => {
  it('sends one search page request and returns its page', async () => {
    const sent: AppMessage[] = []
    const fetcher = createBoardSearchPageFetcher(
      transportAnswering((m) => ({ type: 'BOARD_PAGE_COLLECTED', requestId: (m as { requestId: string }).requestId, page: 4, result: empty }), sent),
      () => 'req-1',
    )
    await expect(fetcher.read(page)).resolves.toEqual(empty)
    expect(sent).toEqual([{ type: 'COLLECT_BOARD_SEARCH_PAGE', requestId: 'req-1', cafeId: '14538121', pageSize: 50, ...page }])
  })

  it('turns an extension error into a page error with its code', async () => {
    const fetcher = createBoardSearchPageFetcher(
      transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'BOARD_SEARCH_HTTP_ERROR', message: 'BOARD_SEARCH_HTTP_ERROR' }), []),
      () => 'req-1',
    )
    await expect(fetcher.read(page)).rejects.toEqual(new CollectionPageError('BOARD_SEARCH_HTTP_ERROR'))
  })
})
