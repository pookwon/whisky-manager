import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import { CAFE_ARTICLE_LIST } from '../shared/cafeArticleFixture.js'
import { CAFE_BOARD_SEARCH, type BoardSearchPage } from '../shared/cafeBoardSearchEndpoint.js'
import { TIMEOUTS, type AppMessage } from '../shared/protocol.js'
import { CollectionPageError } from './collectionPageError.js'
import { parserRuleDetail } from './parserRuleDetail.js'
import type { ExtensionTransport } from './ws/server.js'

export interface BoardSearchPageFetcher {
  read(page: BoardSearchPage): Promise<CollectedArticlePage>
}

export function createBoardSearchPageFetcher(transport: ExtensionTransport, newRequestId: () => string): BoardSearchPageFetcher {
  return {
    async read(page) {
      const message: Extract<AppMessage, { type: 'COLLECT_BOARD_SEARCH_PAGE' }> = {
        type: 'COLLECT_BOARD_SEARCH_PAGE',
        requestId: newRequestId(),
        cafeId: CAFE_ARTICLE_LIST.cafeId,
        pageSize: CAFE_BOARD_SEARCH.perPage,
        ...page,
      }
      const reply = await transport.request(message, TIMEOUTS.boardPageMs)
      if (reply.type === 'BOARD_PAGE_COLLECTED') return reply.result
      // The rule a refused page broke rides along so the run's stop reason names it.
      if (reply.type === 'ERROR') throw new CollectionPageError(reply.code, parserRuleDetail(reply, 'BOARD_SEARCH_PARSE_ERROR'))
      throw new CollectionPageError('BOARD_SEARCH_UNEXPECTED_REPLY')
    },
  }
}
