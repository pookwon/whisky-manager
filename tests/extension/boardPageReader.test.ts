import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createBoardPageReader } from '../../src/extension/boardPageReader.js'
import { cafeArticleListUrl } from '../../src/shared/cafeArticleFixture.js'
import type { CollectBoardPageRequest } from '../../src/shared/protocol.js'

const pageOne = readFileSync(fileURLToPath(new URL('../fixtures/cafe-article-list-page-1.json', import.meta.url)), 'utf8')

const request: CollectBoardPageRequest = {
  type: 'COLLECT_BOARD_PAGE',
  requestId: 'page-1',
  cafeId: '14538121',
  menuId: '0',
  page: 1,
  pageSize: 50,
  sortBy: 'TIME',
  viewType: 'L',
}

describe('BoardPageReader', () => {
  it('fetches and parses exactly one fixed list page', async () => {
    const seen: string[] = []
    const reader = createBoardPageReader({
      http: async ({ url }) => {
        seen.push(url)
        return { status: 200, contentType: 'application/json', text: pageOne }
      },
    })

    await expect(reader.read(request)).resolves.toMatchObject({
      ok: true,
      page: 1,
      result: { pageIdentity: 'fnv1a64:99ee2c43e0e8092d', items: expect.arrayContaining([expect.objectContaining({ postId: '925866' })]) },
    })
    expect(seen).toEqual([cafeArticleListUrl(1)])
  })

  it('returns body-free stable errors for invalid requests, HTTP failure, and malformed responses', async () => {
    const invalid = createBoardPageReader({ http: async () => ({ status: 200, contentType: null, text: pageOne }) })
    await expect(invalid.read({ ...request, page: 0 } as CollectBoardPageRequest)).resolves.toEqual({ ok: false, code: 'BOARD_PAGE_BAD_REQUEST' })

    const http = createBoardPageReader({ http: async () => ({ status: 403, contentType: 'text/html', text: '<html>private</html>' }) })
    await expect(http.read(request)).resolves.toEqual({ ok: false, code: 'BOARD_PAGE_HTTP_ERROR' })

    const network = createBoardPageReader({ http: async () => { throw new Error('socket reset') } })
    await expect(network.read(request)).resolves.toEqual({ ok: false, code: 'BOARD_PAGE_NETWORK_ERROR' })

    const invalidJson = createBoardPageReader({ http: async () => ({ status: 200, contentType: 'text/html', text: '<html>login</html>' }) })
    await expect(invalidJson.read(request)).resolves.toEqual({ ok: false, code: 'BOARD_PAGE_INVALID_JSON' })

    const malformed = createBoardPageReader({ http: async () => ({ status: 200, contentType: 'application/json', text: '{"result":{"articleList":[]}}' }) })
    await expect(malformed.read(request)).resolves.toEqual({ ok: false, code: 'BOARD_PAGE_PARSE_ERROR' })
  })
})
