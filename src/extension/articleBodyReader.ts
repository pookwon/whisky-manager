import { CAFE_ARTICLE_READ, cafeArticleReadReferer, cafeArticleReadUrl } from '../shared/cafeArticleEndpoint.js'
import { type CafeArticleBodyRead, parseCafeArticleBodyText } from '../shared/cafeArticleBody.js'
import { CafeArticleListParseError } from '../shared/cafeArticleList.js'
import { cafeRefusalCode } from '../shared/cafeArticleRead.js'
import type { Http, HttpResponse } from '../shared/http.js'
import { isCollectArticleBodyRequest, type CollectArticleBodyRequest } from '../shared/protocol.js'

export type ArticleBodyReadResult =
  | { readonly ok: true; readonly result: CafeArticleBodyRead }
  | {
      readonly ok: false
      readonly code:
        | 'ARTICLE_BODY_BAD_REQUEST'
        | 'ARTICLE_BODY_NETWORK_ERROR'
        | 'ARTICLE_BODY_HTTP_ERROR'
        | 'ARTICLE_BODY_INVALID_JSON'
        | 'ARTICLE_BODY_PARSE_ERROR'
      /** Which parser rule the body broke: its code and path, never the article's content. */
      readonly detail?: string
    }

/**
 * Reads exactly one article's body by id, over the same endpoint the article
 * reader uses. Like it, it has no loop, cursor, sleep or storage, and it judges
 * nothing: a refusal that names the cafe's own code goes back as that code and
 * its status, and which codes mean "deleted" or "not readable" is the desktop's
 * business.
 */
export function createArticleBodyReader(deps: { readonly http: Http }) {
  return {
    async read(request: CollectArticleBodyRequest): Promise<ArticleBodyReadResult> {
      if (!isCollectArticleBodyRequest(request)) return { ok: false, code: 'ARTICLE_BODY_BAD_REQUEST' }

      let response: HttpResponse
      try {
        response = await deps.http({
          url: cafeArticleReadUrl(request.postId),
          headers: CAFE_ARTICLE_READ.headers,
          referer: cafeArticleReadReferer(request.postId),
        })
      } catch {
        return { ok: false, code: 'ARTICLE_BODY_NETWORK_ERROR' }
      }
      if (response.status !== 200) {
        const code = cafeRefusalCode(response.text)
        return code === null ? { ok: false, code: 'ARTICLE_BODY_HTTP_ERROR' } : { ok: true, result: { kind: 'absent', status: response.status, code } }
      }

      try {
        return { ok: true, result: { kind: 'article', ...parseCafeArticleBodyText(request.postId, response.text) } }
      } catch (error) {
        if (error instanceof CafeArticleListParseError && error.code === 'INVALID_JSON') return { ok: false, code: 'ARTICLE_BODY_INVALID_JSON' }
        if (error instanceof CafeArticleListParseError) return { ok: false, code: 'ARTICLE_BODY_PARSE_ERROR', detail: error.rule }
        return { ok: false, code: 'ARTICLE_BODY_PARSE_ERROR' }
      }
    },
  }
}
