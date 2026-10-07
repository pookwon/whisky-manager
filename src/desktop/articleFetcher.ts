import { CAFE_ARTICLE_LIST } from '../shared/cafeArticleFixture.js'
import type { CafeArticleRead } from '../shared/cafeArticleRead.js'
import { TIMEOUTS, type CollectArticleRequest } from '../shared/protocol.js'
import { stopReasonDetail } from './collectionFailure.js'
import { CollectionPageError } from './collectionPageError.js'
import { parserRuleDetail } from './parserRuleDetail.js'
import type { ExtensionTransport } from './ws/server.js'

export interface ArticleFetcher {
  read(postId: string): Promise<CafeArticleRead>
}

/**
 * The id rides in the error's detail, so a failed run's stop reason says which
 * id it stopped at — and, for a refused article, which parser rule it broke.
 */
function articleErrorDetail(postId: string, rule?: string): string {
  return rule === undefined ? `id ${postId}` : stopReasonDetail(`id ${postId}, ${rule}`)
}

export function createArticleFetcher(transport: ExtensionTransport, newRequestId: () => string): ArticleFetcher {
  return {
    async read(postId) {
      const message: CollectArticleRequest = { type: 'COLLECT_ARTICLE', requestId: newRequestId(), cafeId: CAFE_ARTICLE_LIST.cafeId, postId }
      const reply = await transport.request(message, TIMEOUTS.articleMs)
      if (reply.type === 'ARTICLE_COLLECTED') return reply.result
      if (reply.type === 'ERROR') throw new CollectionPageError(reply.code, articleErrorDetail(postId, parserRuleDetail(reply, 'ARTICLE_PARSE_ERROR')))
      throw new CollectionPageError('ARTICLE_UNEXPECTED_REPLY', articleErrorDetail(postId))
    },
  }
}
