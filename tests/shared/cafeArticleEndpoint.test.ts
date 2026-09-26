import { describe, expect, it } from 'vitest'
import { CAFE_ARTICLE_READ, cafeArticleReadReferer, cafeArticleReadUrl, isArticleId } from '../../src/shared/cafeArticleEndpoint.js'

describe('cafe article read endpoint', () => {
  it('asks for one article the way the cafe\'s article page does', () => {
    expect(cafeArticleReadUrl('728686')).toBe(
      'https://article.cafe.naver.com/gw/v4/cafes/14538121/articles/728686?fromList=true&menuId=0&tc=cafe_article_list&useCafeId=true',
    )
    expect(CAFE_ARTICLE_READ.headers).toEqual({ 'x-cafe-product': 'pc' })
    expect(cafeArticleReadReferer('728686')).toBe('https://cafe.naver.com/ca-fe/cafes/14538121/articles/728686')
  })

  it.each(['0', '0728686', '72a', '', ' 1', '9007199254740993'])('refuses %j as an id', (value) => {
    expect(isArticleId(value)).toBe(false)
    expect(() => cafeArticleReadUrl(value)).toThrow()
    expect(() => cafeArticleReadReferer(value)).toThrow()
  })

  it('accepts a decimal id within the safe range', () => {
    expect(isArticleId('1')).toBe(true)
    expect(isArticleId('753801')).toBe(true)
  })
})
