import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createBoardSearchPageReader } from '../../src/extension/boardSearchPageReader.js'
import { cafeBoardSearchReferer, cafeBoardSearchUrl } from '../../src/shared/cafeBoardSearchEndpoint.js'
import type { HttpRequest } from '../../src/shared/http.js'
import type { CollectBoardSearchPageRequest } from '../../src/shared/protocol.js'

const sample = readFileSync(fileURLToPath(new URL('../fixtures/cafe-board-search-sample.json', import.meta.url)), 'utf8')

const request: CollectBoardSearchPageRequest = {
  type: 'COLLECT_BOARD_SEARCH_PAGE',
  requestId: 'search-1',
  cafeId: '14538121',
  menuId: '137',
  query: '글렌',
  fromDay: '20250101',
  toDay: '20250131',
  page: 3,
  pageSize: 50,
}

describe('BoardSearchPageReader', () => {
  it('asks for exactly one page the way the search screen does', async () => {
    const seen: HttpRequest[] = []
    const reader = createBoardSearchPageReader({
      http: async (init) => {
        seen.push(init)
        return { status: 200, contentType: 'application/json', text: sample }
      },
    })
    await expect(reader.read(request)).resolves.toMatchObject({ ok: true, page: 3, result: { items: [{ postId: '667901' }, { postId: '667850' }] } })
    expect(seen).toEqual([
      {
        url: cafeBoardSearchUrl({ menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250131', page: 3 }),
        headers: { 'x-cafe-product': 'pc' },
        referer: cafeBoardSearchReferer('137'),
      },
    ])
  })

  it('names each way a read can fail', async () => {
    const answer = (status: number, text: string) => createBoardSearchPageReader({ http: async () => ({ status, contentType: null, text }) })
    await expect(answer(400, '').read(request)).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_HTTP_ERROR' })
    await expect(answer(200, '<html>').read(request)).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_INVALID_JSON' })
    await expect(answer(200, '{"result":{}}').read(request)).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_PARSE_ERROR', detail: 'INVALID_ENVELOPE: result.articleList must be an array' })
    const offline = createBoardSearchPageReader({ http: async () => { throw new Error('offline') } })
    await expect(offline.read(request)).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_NETWORK_ERROR' })
    await expect(offline.read({ ...request, menuId: '0' })).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_BAD_REQUEST' })
  })

  it('names the parser rule a page broke, by its code and path and never by its content', async () => {
    const body = JSON.parse(sample) as { result: { articleList: { item: Record<string, unknown> }[] } }
    body.result.articleList[1]!.item.writerInfo = 'private-nickname'
    const reader = createBoardSearchPageReader({ http: async () => ({ status: 200, contentType: 'application/json', text: JSON.stringify(body) }) })
    const result = await reader.read(request)
    expect(result).toEqual({ ok: false, code: 'BOARD_SEARCH_PARSE_ERROR', detail: 'INVALID_ARTICLE: result.articleList[1].item.writerInfo must be an object' })
    expect(JSON.stringify(result)).not.toContain('private-nickname')
  })
})
