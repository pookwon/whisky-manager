import { describe, expect, it } from 'vitest'
import {
  cafeBoardSearchReferer,
  cafeBoardSearchUrl,
  isBoardSearchQuery,
  isCafeBoardSearchEndpoint,
} from '../../src/shared/cafeBoardSearchEndpoint.js'

describe('cafeBoardSearchUrl', () => {
  it('builds the request the search screen makes', () => {
    const url = new URL(cafeBoardSearchUrl({ menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250131', page: 2 }))
    expect(url.origin + url.pathname).toBe('https://apis.cafe.naver.com/search/v2/cafes/14538121/search/articles')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: '글렌',
      perPage: '50',
      page: '2',
      menuId: '137',
      searchBy: '1',
      'writeTime.min': '20250101',
      'writeTime.max': '20250131',
      views: 'MEMBER_LEVEL,COUNT,SALE_INFO,CAFE_MENU',
    })
  })

  it('refuses what the protocol would refuse', () => {
    const ok = { menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250131', page: 1 }
    expect(() => cafeBoardSearchUrl({ ...ok, menuId: '0' })).toThrow()
    expect(() => cafeBoardSearchUrl({ ...ok, query: '글' })).toThrow()
    expect(() => cafeBoardSearchUrl({ ...ok, fromDay: '20250201' })).toThrow()
    expect(() => cafeBoardSearchUrl({ ...ok, page: 0 })).toThrow()
  })

  it('points the referer at the board being searched', () => {
    expect(cafeBoardSearchReferer('137')).toBe('https://cafe.naver.com/f-e/cafes/14538121/menus/137')
  })

  it('recognises only this cafe search path', () => {
    expect(isCafeBoardSearchEndpoint(cafeBoardSearchUrl({ menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250131', page: 1 }))).toBe(true)
    expect(isCafeBoardSearchEndpoint('https://apis.cafe.naver.com/search/v2/cafes/1/search/articles')).toBe(false)
    expect(isCafeBoardSearchEndpoint('https://apis.naver.com/search/v2/cafes/14538121/search/articles')).toBe(false)
  })
})

describe('isBoardSearchQuery', () => {
  it('takes 2 to 40 characters with no surrounding space or control character', () => {
    expect(isBoardSearchQuery('gs')).toBe(true)
    expect(isBoardSearchQuery('글렌알라키')).toBe(true)
    expect(isBoardSearchQuery('글')).toBe(false)
    expect(isBoardSearchQuery(' 글렌')).toBe(false)
    expect(isBoardSearchQuery('글\n렌')).toBe(false)
    expect(isBoardSearchQuery('가'.repeat(41))).toBe(false)
  })
})
