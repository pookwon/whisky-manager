import { describe, expect, it } from 'vitest'
import { createArticleBodyFetcher } from '../../src/desktop/articleBodyFetcher.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { AppMessage, ExtensionMessage } from '../../src/shared/protocol.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'

function transportAnswering(reply: (message: AppMessage) => ExtensionMessage, sent: AppMessage[]): ExtensionTransport {
  return {
    isConnected: () => true,
    request: async (message: AppMessage) => {
      sent.push(message)
      return reply(message)
    },
  } as unknown as ExtensionTransport
}

const absent = { kind: 'absent' as const, status: 404, code: '4003' }

describe('createArticleBodyFetcher', () => {
  it('sends one article body request and returns what the cafe said', async () => {
    const sent: AppMessage[] = []
    const fetcher = createArticleBodyFetcher(transportAnswering((m) => ({ type: 'ARTICLE_BODY_COLLECTED', requestId: (m as { requestId: string }).requestId, result: absent }), sent), () => 'req-1')
    await expect(fetcher.read('963460')).resolves.toEqual(absent)
    expect(sent).toEqual([{ type: 'COLLECT_ARTICLE_BODY', requestId: 'req-1', cafeId: '14538121', postId: '963460' }])
  })

  it('turns an extension error into a page error with its code and the id', async () => {
    const fetcher = createArticleBodyFetcher(transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'ARTICLE_BODY_HTTP_ERROR', message: 'ARTICLE_BODY_HTTP_ERROR' }), []), () => 'req-1')
    await expect(fetcher.read('963460')).rejects.toEqual(new CollectionPageError('ARTICLE_BODY_HTTP_ERROR', 'id 963460'))
  })

  it('refuses a reply meant for another request kind', async () => {
    const fetcher = createArticleBodyFetcher(transportAnswering(() => ({ type: 'COMMENTS', requestId: 'req-1', authors: null }), []), () => 'req-1')
    await expect(fetcher.read('963460')).rejects.toEqual(new CollectionPageError('ARTICLE_BODY_UNEXPECTED_REPLY', 'id 963460'))
  })

  it('keeps the rule a refused body broke beside its id, bounded, and no other error\'s message', async () => {
    const rule = 'INVALID_ARTICLE: result.article.contentHtml must be a string'
    const refused = createArticleBodyFetcher(transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'ARTICLE_BODY_PARSE_ERROR', message: rule }), []), () => 'req-1')
    await expect(refused.read('963460')).rejects.toEqual(new CollectionPageError('ARTICLE_BODY_PARSE_ERROR', `id 963460, ${rule}`))

    const long = createArticleBodyFetcher(transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'ARTICLE_BODY_PARSE_ERROR', message: `INVALID_ARTICLE: ${'x'.repeat(400)}` }), []), () => 'req-1')
    await expect(long.read('963460')).rejects.toSatisfy((error: CollectionPageError) => error.detail?.length === 200 && error.detail.startsWith('id 963460, INVALID_ARTICLE'))

    const other = createArticleBodyFetcher(transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'ARTICLE_BODY_HTTP_ERROR', message: 'anything at all' }), []), () => 'req-1')
    await expect(other.read('963460')).rejects.toEqual(new CollectionPageError('ARTICLE_BODY_HTTP_ERROR', 'id 963460'))
  })
})
