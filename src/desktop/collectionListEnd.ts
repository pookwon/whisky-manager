import type { CollectedArticlePage } from '../shared/cafeArticleList.js'

/**
 * Whether the cafe answered a page past the end of a list instead of the page
 * asked for. It answers that in one of two ways: from its newest page, which
 * the whole-cafe list does and every list does past page 1000; or, on a board
 * whose list ends sooner, with no posts at all — seen 2026-10 on boards 43,
 * 165, 235 and 253, whose walks met an empty page where their lists ran out.
 */
export function isPastListEnd(page: CollectedArticlePage, requested: number): boolean {
  return page.items.length === 0 || requested > page.pageInfo.lastNavigationPageNumber
}
