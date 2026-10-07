import { safeInteger, type CafeArticleListParseErrorCode, type JsonRecord } from './cafeArticleList.js'

/**
 * What the cafe answers for a count it does not know. Seen live as
 * `commentCount` in the board search (captured 2026-09-26: board 137 "홈플"
 * page 2, articleId 753801) and in a board's own list (captured 2026-10-08:
 * board 207 page 11, articleId 452015, a visit-count event post), where it
 * refused the whole page.
 */
const UNKNOWN_COUNT = -1

/**
 * A counter the cafe reports beside a post or a page: its value, or null when
 * the cafe answered -1. Only that one sentinel is read as unknown. Any other
 * negative, null, a string or a missing key still fails with `code`: a renamed
 * or retyped field must stop the walk, not read as unknown forever.
 */
export function cafeCount(record: JsonRecord, key: string, path: string, code: CafeArticleListParseErrorCode): number | null {
  const value = safeInteger(record, key, path, UNKNOWN_COUNT, code)
  return value === UNKNOWN_COUNT ? null : value
}
