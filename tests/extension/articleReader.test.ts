import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createArticleReader } from '../../src/extension/articleReader.js'
import { cafeArticleReadReferer, cafeArticleReadUrl } from '../../src/shared/cafeArticleEndpoint.js'
import type { HttpRequest } from '../../src/shared/http.js'
import type { CollectArticleRequest } from '../../src/shared/protocol.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
const request: CollectArticleRequest = { type: 'COLLECT_ARTICLE', requestId: 'article-1', cafeId: '14538121', postId: '728686' }
const answer = (status: number, text: string) => createArticleReader({ http: async () => ({ status, contentType: 'application/json', text }) })

describe('ArticleReader', () => {
  it('asks for exactly one article the way the article page does', async () => {
    const seen: HttpRequest[] = []
    const reader = createArticleReader({
      http: async (init) => {
        seen.push(init)
        return { status: 200, contentType: 'application/json', text: fixture('cafe-article-read-728686.json') }
      },
    })
    await expect(reader.read(request)).resolves.toMatchObject({ ok: true, result: { kind: 'article', isNotice: false, post: { postId: '728686', boardId: '137' } } })
    expect(seen).toEqual([{ url: cafeArticleReadUrl('728686'), headers: { 'x-cafe-product': 'pc' }, referer: cafeArticleReadReferer('728686') }])
  })

  it('passes on the cafe\'s reason for having no post, with its status', async () => {
    await expect(answer(404, fixture('cafe-article-read-deleted.json')).read(request)).resolves.toEqual({ ok: true, result: { kind: 'absent', status: 404, code: '4003' } })
    await expect(answer(401, fixture('cafe-article-read-login.json')).read(request)).resolves.toEqual({ ok: true, result: { kind: 'absent', status: 401, code: '0004' } })
  })

  it('names each way a read can fail', async () => {
    await expect(answer(500, '<html>').read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_HTTP_ERROR' })
    await expect(answer(200, '<html>').read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_INVALID_JSON' })
    await expect(answer(200, '{"result":{}}').read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_PARSE_ERROR' })
    await expect(answer(200, fixture('cafe-article-read-728686.json')).read({ ...request, postId: '728687' })).resolves.toEqual({ ok: false, code: 'ARTICLE_PARSE_ERROR' })
    const offline = createArticleReader({ http: async () => { throw new Error('offline') } })
    await expect(offline.read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_NETWORK_ERROR' })
    await expect(offline.read({ ...request, postId: '0' })).resolves.toEqual({ ok: false, code: 'ARTICLE_BAD_REQUEST' })
  })
})
