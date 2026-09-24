import { CafeArticleListParseError, type CollectedArticlePage } from '../shared/cafeArticleList.js'
import { parseCafeBoardSearchListText } from '../shared/cafeBoardSearchList.js'
import { CAFE_BOARD_SEARCH, cafeBoardSearchReferer, cafeBoardSearchUrl } from '../shared/cafeBoardSearchEndpoint.js'
import type { Http, HttpResponse } from '../shared/http.js'
import { isCollectBoardSearchPageRequest, type CollectBoardSearchPageRequest } from '../shared/protocol.js'

export type BoardSearchPageReadResult =
  | { readonly ok: true; readonly page: number; readonly result: CollectedArticlePage }
  | {
      readonly ok: false
      readonly code: 'BOARD_SEARCH_BAD_REQUEST' | 'BOARD_SEARCH_NETWORK_ERROR' | 'BOARD_SEARCH_HTTP_ERROR' | 'BOARD_SEARCH_INVALID_JSON' | 'BOARD_SEARCH_PARSE_ERROR'
    }

/**
 * Reads exactly one page of one board's title search. Like the list reader it
 * has no loop, cursor, sleep or storage: which query and page come next is the
 * desktop's business.
 */
export function createBoardSearchPageReader(deps: { readonly http: Http }) {
  return {
    async read(request: CollectBoardSearchPageRequest): Promise<BoardSearchPageReadResult> {
      if (!isCollectBoardSearchPageRequest(request)) return { ok: false, code: 'BOARD_SEARCH_BAD_REQUEST' }

      let response: HttpResponse
      try {
        response = await deps.http({
          url: cafeBoardSearchUrl(request),
          headers: CAFE_BOARD_SEARCH.headers,
          referer: cafeBoardSearchReferer(request.menuId),
        })
      } catch {
        return { ok: false, code: 'BOARD_SEARCH_NETWORK_ERROR' }
      }
      if (response.status !== 200) return { ok: false, code: 'BOARD_SEARCH_HTTP_ERROR' }

      try {
        return { ok: true, page: request.page, result: parseCafeBoardSearchListText(response.text) }
      } catch (error) {
        if (error instanceof CafeArticleListParseError && error.code === 'INVALID_JSON') return { ok: false, code: 'BOARD_SEARCH_INVALID_JSON' }
        return { ok: false, code: 'BOARD_SEARCH_PARSE_ERROR' }
      }
    },
  }
}
