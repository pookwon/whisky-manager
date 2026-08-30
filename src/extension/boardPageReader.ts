import { cafeArticleListUrl } from '../shared/cafeArticleFixture.js'
import { CafeArticleListParseError, parseCafeArticleListText, type CollectedArticlePage } from '../shared/cafeArticleList.js'
import { isCollectBoardPageRequest, type CollectBoardPageRequest } from '../shared/protocol.js'
import type { HttpRequest, HttpResponse } from './cafeClient.js'

export type BoardPageReadResult =
  | { readonly ok: true; readonly page: number; readonly result: CollectedArticlePage }
  | {
      readonly ok: false
      readonly code: 'BOARD_PAGE_BAD_REQUEST' | 'BOARD_PAGE_NETWORK_ERROR' | 'BOARD_PAGE_HTTP_ERROR' | 'BOARD_PAGE_INVALID_JSON' | 'BOARD_PAGE_PARSE_ERROR'
    }

export interface BoardPageReaderDeps {
  /** The extension-owned request keeps credentials and charset decoding in one boundary. */
  readonly http: (request: HttpRequest) => Promise<HttpResponse>
}

/**
 * Reads exactly one structured list page. Pagination is desktop-owned, so this
 * reader intentionally has no loop, cursor, sleep, or storage policy.
 */
export function createBoardPageReader(deps: BoardPageReaderDeps) {
  return {
    async read(request: CollectBoardPageRequest): Promise<BoardPageReadResult> {
      if (!isCollectBoardPageRequest(request)) return { ok: false, code: 'BOARD_PAGE_BAD_REQUEST' }

      let response: HttpResponse
      try {
        response = await deps.http({ url: cafeArticleListUrl(request.page) })
      } catch {
        return { ok: false, code: 'BOARD_PAGE_NETWORK_ERROR' }
      }
      if (response.status !== 200) return { ok: false, code: 'BOARD_PAGE_HTTP_ERROR' }

      try {
        return { ok: true, page: request.page, result: parseCafeArticleListText(response.text) }
      } catch (error) {
        if (error instanceof CafeArticleListParseError && error.code === 'INVALID_JSON') {
          return { ok: false, code: 'BOARD_PAGE_INVALID_JSON' }
        }
        return { ok: false, code: 'BOARD_PAGE_PARSE_ERROR' }
      }
    },
  }
}
