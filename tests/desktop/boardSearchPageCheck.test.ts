import { describe, expect, it } from 'vitest'
import { assertBoardSearchPage } from '../../src/desktop/boardSearchPageCheck.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'

const post = (postId: string, boardId: string, postedAt: number): CollectedPostMetadata => ({
  cafeId: '14538121', postId, boardId, boardName: null, title: 't', prefix: null, authorId: null, authorNickname: null,
  postedAt, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false,
})
const pageOf = (items: CollectedPostMetadata[]): CollectedArticlePage => ({
  items, pageInfo: { totalArticleCount: items.length, lastNavigationPageNumber: 1, visibleNextButton: false }, pageIdentity: 'x',
})
const window = { boardId: '137', fromDay: '20250101', toDay: '20250131' }
const code = (run: () => void) => { try { run(); return null } catch (e) { return (e as CollectionPageError).code } }

describe('assertBoardSearchPage', () => {
  it('accepts posts of the board inside the KST window, both ends included', () => {
    const firstInstant = Date.UTC(2024, 11, 31, 15) // 2025-01-01 00:00 KST
    const lastInstant = Date.UTC(2025, 0, 31, 14, 59, 59, 999) // 2025-01-31 23:59:59.999 KST
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '137', firstInstant), post('2', '137', lastInstant)]), window))).toBeNull()
  })

  it('refuses a post from another board', () => {
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '188', Date.UTC(2025, 0, 10))]), window))).toBe('BOARD_SEARCH_WRONG_BOARD')
  })

  it('refuses a post outside the window', () => {
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '137', Date.UTC(2025, 0, 31, 15))]), window))).toBe('BOARD_SEARCH_OUT_OF_WINDOW')
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '137', Date.UTC(2024, 11, 31, 14, 59))]), window))).toBe('BOARD_SEARCH_OUT_OF_WINDOW')
  })
})
