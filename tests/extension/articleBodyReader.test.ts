import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createArticleBodyReader } from '../../src/extension/articleBodyReader.js'
import { cafeArticleReadReferer, cafeArticleReadUrl } from '../../src/shared/cafeArticleEndpoint.js'
import type { HttpRequest } from '../../src/shared/http.js'
import type { CollectArticleBodyRequest } from '../../src/shared/protocol.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
const request: CollectArticleBodyRequest = { type: 'COLLECT_ARTICLE_BODY', requestId: 'body-1', cafeId: '14538121', postId: '963460' }
const answer = (status: number, text: string) => createArticleBodyReader({ http: async () => ({ status, contentType: 'application/json', text }) })

describe('ArticleBodyReader', () => {
  it('asks for exactly one article the way the article page does', async () => {
    const seen: HttpRequest[] = []
    const reader = createArticleBodyReader({
      http: async (init) => {
        seen.push(init)
        return { status: 200, contentType: 'application/json', text: fixture('cafe-article-body-attendance.json') }
      },
    })
    await expect(reader.read(request)).resolves.toMatchObject({ ok: true, result: { kind: 'article', postId: '963460' } })
    expect(seen).toEqual([{ url: cafeArticleReadUrl('963460'), headers: { 'x-cafe-product': 'pc' }, referer: cafeArticleReadReferer('963460') }])
  })

  it('passes on the cafe\'s reason for having no post, with its status', async () => {
    await expect(answer(404, fixture('cafe-article-read-deleted.json')).read(request)).resolves.toEqual({ ok: true, result: { kind: 'absent', status: 404, code: '4003' } })
  })

  it('names each way a read can fail', async () => {
    await expect(answer(500, '<html>').read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_BODY_HTTP_ERROR' })
    await expect(answer(200, '<html>').read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_BODY_INVALID_JSON' })
    const offline = createArticleBodyReader({ http: async () => { throw new Error('offline') } })
    await expect(offline.read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_BODY_NETWORK_ERROR' })
    await expect(offline.read({ ...request, postId: '0' })).resolves.toEqual({ ok: false, code: 'ARTICLE_BODY_BAD_REQUEST' })
  })

  it('names the parser rule a body-less article broke, by its code and path and never by its content', async () => {
    const body = JSON.parse(fixture('cafe-article-body-attendance.json')) as { result: { article: Record<string, unknown> } }
    delete body.result.article.contentHtml
    const result = await answer(200, JSON.stringify(body)).read(request)
    expect(result).toEqual({ ok: false, code: 'ARTICLE_BODY_PARSE_ERROR', detail: 'INVALID_ARTICLE: result.article.contentHtml is missing' })
    expect(JSON.stringify(result)).not.toContain('개근상')
  })
})
