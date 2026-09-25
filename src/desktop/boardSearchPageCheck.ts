import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import { kstDayKeyRange } from '../shared/kst.js'
import { CollectionPageError } from './collectionPageError.js'

export interface BoardSearchWindow {
  readonly boardId: string
  readonly fromDay: string
  readonly toDay: string
}

// The search API sorts results by the second and leaves sub-second order undefined.
// Captured 2026-09-26: board 137 "트레이더스" page 15 served post 691290
// (2025-03-16T12:51:32.743 KST) immediately before 691291 (2025-03-16T12:51:32.993 KST).
const BOARD_SEARCH_ORDER_PRECISION_MS = 1000

/** Returns true when `newer` is strictly newer than `older` at the search's ordering precision (one second). */
function isNewerBySecond(newer: number, older: number): boolean {
  return Math.floor(newer / BOARD_SEARCH_ORDER_PRECISION_MS) > Math.floor(older / BOARD_SEARCH_ORDER_PRECISION_MS)
}

/**
 * What a search page must be before any of it is stored. The search is asked
 * for one board and one window; a post from anywhere else means the filter came
 * loose, and filling the gap with it would pass a stray post off as recovered.
 * The posts must also come newest first at the search's ordering precision (one
 * second): posts within the same second may appear in any order, but a post
 * that is a full second newer than the one before it violates the order.
 * Narrowing the window at the cap reads the rest of the results as older than
 * a page's oldest post.
 */
export function assertBoardSearchPage(result: CollectedArticlePage, expected: BoardSearchWindow): void {
  const startMs = kstDayKeyRange(expected.fromDay).startMs
  const endMs = kstDayKeyRange(expected.toDay).endMs
  const ids = new Set<string>()
  let previousPostedAt = Number.POSITIVE_INFINITY
  for (const item of result.items) {
    if (ids.has(item.postId)) throw new CollectionPageError('BOARD_PAGE_DUPLICATE_POST', item.postId)
    ids.add(item.postId)
    if (item.boardId !== expected.boardId) throw new CollectionPageError('BOARD_SEARCH_WRONG_BOARD', `${item.postId} on ${item.boardId}`)
    if (item.postedAt < startMs || item.postedAt >= endMs) throw new CollectionPageError('BOARD_SEARCH_OUT_OF_WINDOW', item.postId)
    if (isNewerBySecond(item.postedAt, previousPostedAt)) throw new CollectionPageError('BOARD_SEARCH_OUT_OF_ORDER', item.postId)
    previousPostedAt = item.postedAt
  }
}

/**
 * Consecutive pages of one window continue the same newest-first order at the
 * search's ordering precision (one second): a page whose first post is newer
 * by a full second than the previous page's oldest post means the results
 * shifted under the walk. Posts within the same second as the previous oldest
 * are accepted.
 */
export function assertBoardSearchPageFollows(result: CollectedArticlePage, previousOldestPostedAt: number): void {
  const first = result.items[0]
  if (first !== undefined && isNewerBySecond(first.postedAt, previousOldestPostedAt)) throw new CollectionPageError('BOARD_SEARCH_OUT_OF_ORDER', first.postId)
}
