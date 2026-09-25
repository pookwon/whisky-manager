import { describe, expect, it } from 'vitest'
import { assertBoardSearchPage, assertBoardSearchPageFollows } from '../../src/desktop/boardSearchPageCheck.js'
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
const marchWindow = { boardId: '137', fromDay: '20250301', toDay: '20250331' }
const code = (run: () => void) => { try { run(); return null } catch (e) { return (e as CollectionPageError).code } }

describe('assertBoardSearchPage', () => {
  it('accepts posts of the board inside the KST window, both ends included', () => {
    const firstInstant = Date.UTC(2024, 11, 31, 15) // 2025-01-01 00:00 KST
    const lastInstant = Date.UTC(2025, 0, 31, 14, 59, 59, 999) // 2025-01-31 23:59:59.999 KST
    expect(code(() => assertBoardSearchPage(pageOf([post('2', '137', lastInstant), post('1', '137', firstInstant)]), window))).toBeNull()
  })

  it('refuses a post from another board', () => {
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '188', Date.UTC(2025, 0, 10))]), window))).toBe('BOARD_SEARCH_WRONG_BOARD')
  })

  it('refuses a post outside the window', () => {
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '137', Date.UTC(2025, 0, 31, 15))]), window))).toBe('BOARD_SEARCH_OUT_OF_WINDOW')
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '137', Date.UTC(2024, 11, 31, 14, 59))]), window))).toBe('BOARD_SEARCH_OUT_OF_WINDOW')
  })

  it('refuses a page whose posts are not newest first, and accepts posts of the same instant', () => {
    const inverted = pageOf([post('1', '137', Date.UTC(2025, 0, 10)), post('2', '137', Date.UTC(2025, 0, 11))])
    expect(code(() => assertBoardSearchPage(inverted, window))).toBe('BOARD_SEARCH_OUT_OF_ORDER')
    const tied = pageOf([post('1', '137', Date.UTC(2025, 0, 11)), post('2', '137', Date.UTC(2025, 0, 11)), post('3', '137', Date.UTC(2025, 0, 10))])
    expect(code(() => assertBoardSearchPage(tied, window))).toBeNull()
  })

  // Board 137 "트레이더스" page 15, 2026-09-26: 691290 at 2025-03-16T12:51:32.743 KST
  // came before 691291 at 2025-03-16T12:51:32.993 KST. Both are in the same second;
  // the search orders by the second and leaves sub-second order undefined.
  it('accepts two posts in the same second regardless of sub-second order (captured: 691290/691291)', () => {
    const at32_743 = Date.UTC(2025, 2, 16, 3, 51, 32, 743) // 2025-03-16T12:51:32.743 KST
    const at32_993 = Date.UTC(2025, 2, 16, 3, 51, 32, 993) // 2025-03-16T12:51:32.993 KST
    // 691291 (32.993) after 691290 (32.743): newer by 250 ms but in the same second
    const captured = pageOf([post('691290', '137', at32_743), post('691291', '137', at32_993)])
    expect(code(() => assertBoardSearchPage(captured, marchWindow))).toBeNull()
  })

  it('still refuses a post newer by a whole second', () => {
    const at32_000 = Date.UTC(2025, 2, 16, 3, 51, 32, 0) // 2025-03-16T12:51:32 KST
    const at33_000 = Date.UTC(2025, 2, 16, 3, 51, 33, 0) // 2025-03-16T12:51:33 KST — one second newer
    // second post is a whole second newer than the first, violating newest-first order
    const inverted = pageOf([post('1', '137', at32_000), post('2', '137', at33_000)])
    expect(code(() => assertBoardSearchPage(inverted, marchWindow))).toBe('BOARD_SEARCH_OUT_OF_ORDER')
  })
})

describe('assertBoardSearchPageFollows', () => {
  it('accepts a page whose first post is in the same second as the previous oldest, even if later by milliseconds', () => {
    const previousOldest = Date.UTC(2025, 2, 16, 3, 51, 32, 743) // 32.743
    const nextFirst = Date.UTC(2025, 2, 16, 3, 51, 32, 993)       // 32.993 — same second, newer by 250 ms
    const page = pageOf([post('1', '137', nextFirst)])
    expect(code(() => assertBoardSearchPageFollows(page, previousOldest))).toBeNull()
  })

  it('refuses a page whose first post is newer by a whole second than the previous oldest', () => {
    const previousOldest = Date.UTC(2025, 2, 16, 3, 51, 32, 743) // 32.743
    const nextFirst = Date.UTC(2025, 2, 16, 3, 51, 33, 0)         // 33.000 — one second newer
    const page = pageOf([post('1', '137', nextFirst)])
    expect(code(() => assertBoardSearchPageFollows(page, previousOldest))).toBe('BOARD_SEARCH_OUT_OF_ORDER')
  })
})
