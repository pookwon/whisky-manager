import { CAFE_ARTICLE_LIST } from '../shared/cafeArticleFixture.js'
import type { CafeArticleBodyRead } from '../shared/cafeArticleBody.js'
import { TIMEOUTS, type CollectArticleBodyRequest } from '../shared/protocol.js'
import { stopReasonDetail } from './collectionFailure.js'
import { CollectionPageError } from './collectionPageError.js'
import { parserRuleDetail } from './parserRuleDetail.js'
import type { ExtensionTransport } from './ws/server.js'

export interface ArticleBodyFetcher {
  read(postId: string): Promise<CafeArticleBodyRead>
}

/**
 * The id rides in the error's detail, so a failed run's stop reason says which
 * id it stopped at — and, for a refused body, which parser rule it broke.
 */
function articleBodyErrorDetail(postId: string, rule?: string): string {
  return rule === undefined ? `id ${postId}` : stopReasonDetail(`id ${postId}, ${rule}`)
}

export function createArticleBodyFetcher(transport: ExtensionTransport, newRequestId: () => string): ArticleBodyFetcher {
  return {
    async read(postId) {
      const message: CollectArticleBodyRequest = { type: 'COLLECT_ARTICLE_BODY', requestId: newRequestId(), cafeId: CAFE_ARTICLE_LIST.cafeId, postId }
      const reply = await transport.request(message, TIMEOUTS.articleBodyMs)
      if (reply.type === 'ARTICLE_BODY_COLLECTED') return reply.result
      if (reply.type === 'ERROR') throw new CollectionPageError(reply.code, articleBodyErrorDetail(postId, parserRuleDetail(reply, 'ARTICLE_BODY_PARSE_ERROR')))
      throw new CollectionPageError('ARTICLE_BODY_UNEXPECTED_REPLY', articleBodyErrorDetail(postId))
    },
  }
}
