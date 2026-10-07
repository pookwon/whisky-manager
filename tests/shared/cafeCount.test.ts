import { describe, expect, it } from 'vitest'
import { CafeArticleListParseError } from '../../src/shared/cafeArticleList.js'
import { cafeCount } from '../../src/shared/cafeCount.js'

const countOf = (record: Record<string, unknown>) => cafeCount(record, 'commentCount', 'result.article', 'INVALID_ARTICLE')

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof CafeArticleListParseError ? error.code : 'NOT_A_PARSE_ERROR'
  }
}

describe('cafeCount', () => {
  it('reads -1 as a count the cafe does not know', () => {
    expect(countOf({ commentCount: -1 })).toBeNull()
  })

  it.each([0, 1, 4_812])('keeps the count %i', (value) => {
    expect(countOf({ commentCount: value })).toBe(value)
  })

  it.each([
    ['-2', { commentCount: -2 }],
    ['null', { commentCount: null }],
    ['a string', { commentCount: '3' }],
    ['a fraction', { commentCount: 1.5 }],
    ['a missing key', {}],
  ])('refuses %s with the code it is given', (_label, record) => {
    expect(codeOf(() => cafeCount(record, 'commentCount', 'result.pageInfo', 'INVALID_PAGE_INFO'))).toBe('INVALID_PAGE_INFO')
  })
})
