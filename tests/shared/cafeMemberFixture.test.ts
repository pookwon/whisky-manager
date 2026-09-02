import { describe, expect, it } from 'vitest'
import {
  CAFE_MEMBER_LIST,
  cafeMemberListUrl,
  isCafeMemberListEndpoint,
  isCafeMemberListTarget,
} from '../../src/shared/cafeMemberFixture.js'

describe('cafeMemberFixture', () => {
  it('builds the exact management list URL for a page', () => {
    const url = cafeMemberListUrl(3)
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://cafe.naver.com')
    expect(parsed.pathname).toBe('/ManageMemberListViewAjax.nhn')
    expect(parsed.searchParams.get('search.clubid')).toBe(CAFE_MEMBER_LIST.cafeId)
    expect(parsed.searchParams.get('search.page')).toBe('3')
    expect(parsed.searchParams.get('search.perPage')).toBe('100')
    expect(parsed.searchParams.get('search.searchType')).toBe('0')
    expect(parsed.searchParams.get('search.memberLevel')).toBe('0')
    expect(parsed.searchParams.get('search.sortType')).toBe('0')
    expect(parsed.searchParams.get('search.sortOrder')).toBe('0')
    expect(parsed.searchParams.get('search.paginationCached')).toBe('false')
    expect(parsed.searchParams.get('search.totalCountCached')).toBe('0')
  })

  it('rejects non-positive and unsafe pages', () => {
    expect(() => cafeMemberListUrl(0)).toThrow()
    expect(() => cafeMemberListUrl(-1)).toThrow()
    expect(() => cafeMemberListUrl(1.5)).toThrow()
  })

  it('accepts only the exact endpoint and fixed query', () => {
    expect(isCafeMemberListEndpoint(cafeMemberListUrl(1))).toBe(true)
    expect(isCafeMemberListTarget(cafeMemberListUrl(1))).toBe(true)
    expect(isCafeMemberListTarget('https://cafe.naver.com/ManageMemberListViewAjax.nhn?search.page=1')).toBe(false)
    expect(isCafeMemberListTarget('https://apis.naver.com/x')).toBe(false)
    expect(isCafeMemberListEndpoint('not a url')).toBe(false)
  })
})
