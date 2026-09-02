/**
 * The one read-only management endpoint Phase 0 is allowed to capture for the
 * member list. Keeping the URL and its fixed query here (rather than accepting a
 * free-form URL from the capture CLI) makes it impossible for that CLI to become
 * a general-purpose browser-session dump. Sanitization is reused from the
 * article fixture module: it already replaces memberKey and nickname with
 * deterministic, length-preserving pseudonyms.
 */
export const CAFE_MEMBER_LIST = {
  cafeId: '14538121',
  perPage: 100,
  searchType: 0,
  memberLevel: 0,
  sortType: 0,
  sortOrder: 0,
} as const

const API_ORIGIN = 'https://cafe.naver.com'
const MEMBER_LIST_PATH = '/ManageMemberListViewAjax.nhn'

export function cafeMemberListUrl(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error(`page must be a positive safe integer: ${page}`)
  }
  const url = new URL(`${API_ORIGIN}${MEMBER_LIST_PATH}`)
  url.searchParams.set('search.clubid', CAFE_MEMBER_LIST.cafeId)
  url.searchParams.set('search.searchType', String(CAFE_MEMBER_LIST.searchType))
  url.searchParams.set('search.memberLevel', String(CAFE_MEMBER_LIST.memberLevel))
  url.searchParams.set('search.perPage', String(CAFE_MEMBER_LIST.perPage))
  url.searchParams.set('search.page', String(page))
  url.searchParams.set('search.sortType', String(CAFE_MEMBER_LIST.sortType))
  url.searchParams.set('search.sortOrder', String(CAFE_MEMBER_LIST.sortOrder))
  url.searchParams.set('search.paginationCached', 'false')
  url.searchParams.set('search.totalCountCached', '0')
  return url.toString()
}

/** True for this endpoint regardless of query parameters. */
export function isCafeMemberListEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.origin === API_ORIGIN && url.pathname === MEMBER_LIST_PATH
}

/** True only for the exact Phase 0 member-list request, including its fixed query. */
export function isCafeMemberListTarget(value: string): boolean {
  if (!isCafeMemberListEndpoint(value)) return false
  const url = new URL(value)

  const expected = new Map<string, string>([
    ['search.clubid', CAFE_MEMBER_LIST.cafeId],
    ['search.searchType', String(CAFE_MEMBER_LIST.searchType)],
    ['search.memberLevel', String(CAFE_MEMBER_LIST.memberLevel)],
    ['search.perPage', String(CAFE_MEMBER_LIST.perPage)],
    ['search.sortType', String(CAFE_MEMBER_LIST.sortType)],
    ['search.sortOrder', String(CAFE_MEMBER_LIST.sortOrder)],
    ['search.paginationCached', 'false'],
    ['search.totalCountCached', '0'],
  ])
  if (url.searchParams.size !== expected.size + 1) return false

  const page = url.searchParams.get('search.page')
  if (page === null || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) return false

  for (const [key, expectedValue] of expected) {
    if (url.searchParams.get(key) !== expectedValue) return false
  }
  return true
}

// The member list can carry account-linked data, so the same reviewer-safe
// sanitization the article fixture uses is reused verbatim rather than re-derived.
export { sanitizeCafeArticleFixture, sanitizeCafeArticleFixtureText } from './cafeArticleFixture.js'
