import { CAFE_ARTICLE_LIST, isMenuId } from './cafeArticleFixture.js'
import { isKstDayKey } from './kst.js'

/**
 * The board title search the cafe's own search screen calls (captured
 * 2026-09-25). A different host from the list: `apis.cafe.naver.com`. Without
 * `x-cafe-product: pc` it answers 400 with an empty body. Everything but the
 * board, query, window and page is fixed here, so the extension can never be
 * asked to read anything else through it.
 */
export const CAFE_BOARD_SEARCH = {
  perPage: 50,
  searchBy: '1',
  views: 'MEMBER_LEVEL,COUNT,SALE_INFO,CAFE_MENU',
  headers: { 'x-cafe-product': 'pc' },
  /**
   * `totalArticleCount` stops here: "글렌" reported 2,000 while its pages held
   * 3,369 posts (2026-09-25). The pages go on past it; only the count does not.
   */
  totalCountCap: 2000,
  /**
   * The results one window serves at most: 80 pages of 50. "구매" on 137 over
   * 20250101–20250829 filled pages 1–80 and answered page 81 empty, while the
   * window's two halves held 2,264 and 1,768 posts — 4,032 (2026-09-25). The
   * 32 oldest were never served; only a narrower window reaches them.
   */
  resultCap: 4000,
} as const

/** The last page one window serves; a full one means the cap cut the results off. */
export const BOARD_SEARCH_CAP_PAGE = CAFE_BOARD_SEARCH.resultCap / CAFE_BOARD_SEARCH.perPage

const API_ORIGIN = 'https://apis.cafe.naver.com'
const SEARCH_PATH = `/search/v2/cafes/${CAFE_ARTICLE_LIST.cafeId}/search/articles`
const QUERY_MIN_LENGTH = 2
const QUERY_MAX_LENGTH = 40
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u

export interface BoardSearchPage {
  /** Digits, never '0': a search is scoped to one board. */
  readonly menuId: string
  readonly query: string
  /** KST `yyyymmdd`, inclusive. */
  readonly fromDay: string
  /** KST `yyyymmdd`, inclusive, not before `fromDay`. */
  readonly toDay: string
  readonly page: number
}

export function isBoardSearchQuery(value: string): boolean {
  return (
    value === value.trim() &&
    [...value].length >= QUERY_MIN_LENGTH &&
    [...value].length <= QUERY_MAX_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  )
}

export function isBoardSearchPage(value: BoardSearchPage): boolean {
  return (
    isMenuId(value.menuId) &&
    value.menuId !== CAFE_ARTICLE_LIST.menuId &&
    isBoardSearchQuery(value.query) &&
    isKstDayKey(value.fromDay) &&
    isKstDayKey(value.toDay) &&
    value.fromDay <= value.toDay &&
    Number.isSafeInteger(value.page) &&
    value.page >= 1
  )
}

export function cafeBoardSearchUrl(value: BoardSearchPage): string {
  if (!isBoardSearchPage(value)) throw new Error('not a board search page this endpoint may read')
  const url = new URL(`${API_ORIGIN}${SEARCH_PATH}`)
  url.searchParams.set('query', value.query)
  url.searchParams.set('perPage', String(CAFE_BOARD_SEARCH.perPage))
  url.searchParams.set('page', String(value.page))
  url.searchParams.set('menuId', value.menuId)
  url.searchParams.set('searchBy', CAFE_BOARD_SEARCH.searchBy)
  url.searchParams.set('writeTime.min', value.fromDay)
  url.searchParams.set('writeTime.max', value.toDay)
  url.searchParams.set('views', CAFE_BOARD_SEARCH.views)
  return url.toString()
}

/** The page the request should appear to come from: the board's own screen. */
export function cafeBoardSearchReferer(menuId: string): string {
  if (!isMenuId(menuId)) throw new Error(`menuId must be digits: ${menuId}`)
  return `https://cafe.naver.com/f-e/cafes/${CAFE_ARTICLE_LIST.cafeId}/menus/${menuId}`
}

export function isCafeBoardSearchEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.origin === API_ORIGIN && url.pathname === SEARCH_PATH
}
