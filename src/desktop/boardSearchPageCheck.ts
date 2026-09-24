import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import { kstDayKeyRange } from '../shared/kst.js'
import { CollectionPageError } from './collectionOrchestrator.js'

export interface BoardSearchWindow {
  readonly boardId: string
  readonly fromDay: string
  readonly toDay: string
}

/**
 * What a search page must be before any of it is stored. The search is asked
 * for one board and one window; a post from anywhere else means the filter came
 * loose, and filling the gap with it would pass a stray post off as recovered.
 */
export function assertBoardSearchPage(result: CollectedArticlePage, expected: BoardSearchWindow): void {
  const startMs = kstDayKeyRange(expected.fromDay).startMs
  const endMs = kstDayKeyRange(expected.toDay).endMs
  const ids = new Set<string>()
  for (const item of result.items) {
    if (ids.has(item.postId)) throw new CollectionPageError('BOARD_PAGE_DUPLICATE_POST', item.postId)
    ids.add(item.postId)
    if (item.boardId !== expected.boardId) throw new CollectionPageError('BOARD_SEARCH_WRONG_BOARD', `${item.postId} on ${item.boardId}`)
    if (item.postedAt < startMs || item.postedAt >= endMs) throw new CollectionPageError('BOARD_SEARCH_OUT_OF_WINDOW', item.postId)
  }
}
