import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import { kstDayKeyRange } from '../shared/kst.js'
import { CollectionPageError } from './collectionPageError.js'

export interface BoardSearchWindow {
  readonly boardId: string
  readonly fromDay: string
  readonly toDay: string
}

/**
 * What a search page must be before any of it is stored. The search is asked
 * for one board and one window; a post from anywhere else means the filter came
 * loose, and filling the gap with it would pass a stray post off as recovered.
 * The posts must also come newest first: narrowing the window at the cap reads
 * the rest of the results as older than a page's oldest post.
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
    if (item.postedAt > previousPostedAt) throw new CollectionPageError('BOARD_SEARCH_OUT_OF_ORDER', item.postId)
    previousPostedAt = item.postedAt
  }
}

/**
 * Consecutive pages of one window continue the same newest-first order: a page
 * newer than the one before it means the results shifted under the walk.
 */
export function assertBoardSearchPageFollows(result: CollectedArticlePage, previousOldestPostedAt: number): void {
  const first = result.items[0]
  if (first !== undefined && first.postedAt > previousOldestPostedAt) throw new CollectionPageError('BOARD_SEARCH_OUT_OF_ORDER', first.postId)
}
