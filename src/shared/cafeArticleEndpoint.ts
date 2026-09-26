import { CAFE_ARTICLE_LIST } from './cafeArticleFixture.js'

/**
 * One article read by id — the call the cafe's own article page makes
 * (captured 2026-09-26). It answers one id exactly: the post when it lives, the
 * cafe's own error code when it does not. Reading it does not move the view
 * count (753801 read three times stayed at 669). Everything but the id is fixed
 * here, so the extension can never be asked to read anything else through it.
 */
export const CAFE_ARTICLE_READ = {
  headers: { 'x-cafe-product': 'pc' },
} as const

const ARTICLE_ORIGIN = 'https://article.cafe.naver.com'
const ARTICLE_PATH = `/gw/v4/cafes/${CAFE_ARTICLE_LIST.cafeId}/articles/`
const ARTICLE_ID = /^[1-9]\d*$/

/** Decimal, no leading zero, within Number's safe range: the walk orders ids as numbers. */
export function isArticleId(value: string): boolean {
  return ARTICLE_ID.test(value) && Number.isSafeInteger(Number(value))
}

function assertArticleId(postId: string): void {
  if (!isArticleId(postId)) throw new Error(`not an article id: ${postId}`)
}

export function cafeArticleReadUrl(postId: string): string {
  assertArticleId(postId)
  const url = new URL(`${ARTICLE_ORIGIN}${ARTICLE_PATH}${postId}`)
  url.searchParams.set('fromList', 'true')
  url.searchParams.set('menuId', CAFE_ARTICLE_LIST.menuId)
  url.searchParams.set('tc', 'cafe_article_list')
  url.searchParams.set('useCafeId', 'true')
  return url.toString()
}

/**
 * The page the request should appear to come from: the article's own screen.
 * The host allows only `https://cafe.naver.com` as an origin, which the
 * extension derives from this.
 */
export function cafeArticleReadReferer(postId: string): string {
  assertArticleId(postId)
  return `https://cafe.naver.com/ca-fe/cafes/${CAFE_ARTICLE_LIST.cafeId}/articles/${postId}`
}
