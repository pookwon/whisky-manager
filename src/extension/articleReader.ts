import { CAFE_ARTICLE_READ, cafeArticleReadReferer, cafeArticleReadUrl } from '../shared/cafeArticleEndpoint.js'
import { CafeArticleListParseError } from '../shared/cafeArticleList.js'
import { cafeRefusalCode, parseCafeArticleText, type CafeArticleRead } from '../shared/cafeArticleRead.js'
import type { Http, HttpResponse } from '../shared/http.js'
import { isCollectArticleRequest, type CollectArticleRequest } from '../shared/protocol.js'

export type ArticleReadResult =
  | { readonly ok: true; readonly result: CafeArticleRead }
  | {
      readonly ok: false
      readonly code: 'ARTICLE_BAD_REQUEST' | 'ARTICLE_NETWORK_ERROR' | 'ARTICLE_HTTP_ERROR' | 'ARTICLE_INVALID_JSON' | 'ARTICLE_PARSE_ERROR'
    }

/**
 * Reads exactly one article by id. Like the page readers it has no loop,
 * cursor, sleep or storage, and it judges nothing: a refusal that names the
 * cafe's own code goes back as that code and its status, and which codes mean
 * "deleted" or "not readable" is the desktop's business.
 */
export function createArticleReader(deps: { readonly http: Http }) {
  return {
    async read(request: CollectArticleRequest): Promise<ArticleReadResult> {
      if (!isCollectArticleRequest(request)) return { ok: false, code: 'ARTICLE_BAD_REQUEST' }

      let response: HttpResponse
      try {
        response = await deps.http({
          url: cafeArticleReadUrl(request.postId),
          headers: CAFE_ARTICLE_READ.headers,
          referer: cafeArticleReadReferer(request.postId),
        })
      } catch {
        return { ok: false, code: 'ARTICLE_NETWORK_ERROR' }
      }
      if (response.status !== 200) {
        const code = cafeRefusalCode(response.text)
        return code === null ? { ok: false, code: 'ARTICLE_HTTP_ERROR' } : { ok: true, result: { kind: 'absent', status: response.status, code } }
      }

      try {
        return { ok: true, result: { kind: 'article', ...parseCafeArticleText(request.postId, response.text) } }
      } catch (error) {
        if (error instanceof CafeArticleListParseError && error.code === 'INVALID_JSON') return { ok: false, code: 'ARTICLE_INVALID_JSON' }
        return { ok: false, code: 'ARTICLE_PARSE_ERROR' }
      }
    },
  }
}
