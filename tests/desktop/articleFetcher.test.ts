import { describe, expect, it } from 'vitest'
import { createArticleFetcher } from '../../src/desktop/articleFetcher.js'
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

describe('createArticleFetcher', () => {
  it('sends one article request and returns what the cafe said', async () => {
    const sent: AppMessage[] = []
    const fetcher = createArticleFetcher(transportAnswering((m) => ({ type: 'ARTICLE_COLLECTED', requestId: (m as { requestId: string }).requestId, result: absent }), sent), () => 'req-1')
    await expect(fetcher.read('728686')).resolves.toEqual(absent)
    expect(sent).toEqual([{ type: 'COLLECT_ARTICLE', requestId: 'req-1', cafeId: '14538121', postId: '728686' }])
  })

  it('turns an extension error into a page error with its code and the id', async () => {
    const fetcher = createArticleFetcher(transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'ARTICLE_HTTP_ERROR', message: 'ARTICLE_HTTP_ERROR' }), []), () => 'req-1')
    await expect(fetcher.read('728686')).rejects.toEqual(new CollectionPageError('ARTICLE_HTTP_ERROR', 'id 728686'))
  })

  it('refuses a reply meant for another request kind', async () => {
    const fetcher = createArticleFetcher(transportAnswering(() => ({ type: 'COMMENTS', requestId: 'req-1', authors: null }), []), () => 'req-1')
    await expect(fetcher.read('728686')).rejects.toEqual(new CollectionPageError('ARTICLE_UNEXPECTED_REPLY', 'id 728686'))
  })

  it('keeps the rule a refused article broke beside its id, bounded, and no other error\'s message', async () => {
    const rule = 'INVALID_ARTICLE: result.article.commentCount must be a safe integer at least -1'
    const refused = createArticleFetcher(transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'ARTICLE_PARSE_ERROR', message: rule }), []), () => 'req-1')
    await expect(refused.read('728686')).rejects.toEqual(new CollectionPageError('ARTICLE_PARSE_ERROR', `id 728686, ${rule}`))

    const long = createArticleFetcher(transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'ARTICLE_PARSE_ERROR', message: `INVALID_ARTICLE: ${'x'.repeat(400)}` }), []), () => 'req-1')
    await expect(long.read('728686')).rejects.toSatisfy((error: CollectionPageError) => error.detail?.length === 200 && error.detail.startsWith('id 728686, INVALID_ARTICLE'))

    const other = createArticleFetcher(transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'ARTICLE_HTTP_ERROR', message: 'anything at all' }), []), () => 'req-1')
    await expect(other.read('728686')).rejects.toEqual(new CollectionPageError('ARTICLE_HTTP_ERROR', 'id 728686'))
  })
})
