import type { CollectedArticlePage } from '../shared/cafeArticleList.js'

/**
 * Whether the cafe answered a page past the end of a list instead of the page
 * asked for. It answers that in one of two ways: from its newest page, which
 * the whole-cafe list does and every list does past page 1000; or, on a board
 * whose list ends sooner, with no posts at all — seen 2026-10 where boards 43
 * and 253 ran out during the start-page search and 165 and 235 during the walk.
 */
export function isPastListEnd(page: CollectedArticlePage, requested: number): boolean {
  return page.items.length === 0 || requested > page.pageInfo.lastNavigationPageNumber
}

/**
 * Reads a page, and reads an empty answer once more before it is believed.
 * One empty answer could be the cafe stumbling, and taken as the list's end it
 * ends a feed for good: a board past the horizon comes out holding nothing,
 * and a walk stops short. Only two in a row are the end; when the second
 * holds posts, it is the answer.
 */
export async function readConfirmingEmpty(read: () => Promise<CollectedArticlePage>): Promise<CollectedArticlePage> {
  const first = await read()
  return first.items.length > 0 ? first : await read()
}
