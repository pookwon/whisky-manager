import {
  collectedArticlePage,
  fail,
  nullableString,
  prefixOf,
  record,
  safeInteger,
  type CollectedArticlePage,
  type CollectedPostMetadata,
} from './cafeArticleList.js'
import { decodeHtmlEntities } from './htmlEntities.js'
import { kstLocalDateTimeToEpochMs } from './kst.js'

/**
 * Pure contract for the board title search captured on 2026-09-25
 * (`apis.cafe.naver.com/search/v2/.../search/articles`). The envelope and page
 * info are the list's; three item fields are spelled differently — `addDate`
 * is an offset-less KST time, the nickname is `nickname`, and replies are
 * `refArticleCount`. A malformed response fails loudly for the same reason the
 * list parser does: an empty-looking page would read as the end of a query.
 */

function postedAtOf(item: Record<string, unknown>, path: string): number {
  const addDate = nullableString(item, 'addDate', path, 'INVALID_ARTICLE')
  const postedAt = addDate === null ? null : kstLocalDateTimeToEpochMs(addDate)
  if (postedAt === null) fail('INVALID_ARTICLE', `${path}.addDate is not a KST wall-clock time`)
  return postedAt
}

const SEARCH_HIGHLIGHT = /<\/?b>/g

/**
 * The search answers `subject` as HTML: the matched word wrapped in `<b>`, and
 * `&`, `<`, `>` escaped. The list answers plain text, and a title is one thing
 * whichever feed read it, so the search's is brought back to the plain form.
 * The highlight goes first: a `<b>` the writer typed arrives escaped, and only
 * decoding turns it back into text.
 */
function plainTitle(subject: string | null): string | null {
  return subject === null ? null : decodeHtmlEntities(subject.replace(SEARCH_HIGHLIGHT, ''))
}

function parseSearchArticle(entry: unknown, index: number): CollectedPostMetadata {
  const path = `result.articleList[${index}]`
  const rawEntry = record(entry, path, 'INVALID_ARTICLE')
  if (rawEntry.type !== 'ARTICLE') fail('UNEXPECTED_LIST_ENTRY_TYPE', `${path}.type must be ARTICLE`)
  const itemPath = `${path}.item`
  const item = record(rawEntry.item, itemPath, 'INVALID_ARTICLE')
  const writerInfo = record(item.writerInfo, `${itemPath}.writerInfo`, 'INVALID_ARTICLE')
  return {
    cafeId: String(safeInteger(item, 'cafeId', itemPath, 1, 'INVALID_ARTICLE')),
    postId: String(safeInteger(item, 'articleId', itemPath, 1, 'INVALID_ARTICLE')),
    boardId: String(safeInteger(item, 'menuId', itemPath, 0, 'INVALID_ARTICLE')),
    // The search is scoped to one board and names none; the board is known.
    boardName: null,
    title: plainTitle(nullableString(item, 'subject', itemPath, 'INVALID_ARTICLE')),
    prefix: prefixOf(item, itemPath),
    authorId: nullableString(writerInfo, 'memberKey', `${itemPath}.writerInfo`, 'INVALID_ARTICLE'),
    authorNickname: nullableString(writerInfo, 'nickname', `${itemPath}.writerInfo`, 'INVALID_ARTICLE'),
    postedAt: postedAtOf(item, itemPath),
    viewCount: safeInteger(item, 'readCount', itemPath, 0, 'INVALID_ARTICLE'),
    commentCount: safeInteger(item, 'commentCount', itemPath, 0, 'INVALID_ARTICLE'),
    replyCount: safeInteger(item, 'refArticleCount', itemPath, 0, 'INVALID_ARTICLE'),
    isNotice: false,
  }
}

/**
 * The page past the end of a search that stopped at its result cap answers
 * all-zero page info (captured 2026-09-25: page 81 of 137 "구매" after 80 full
 * pages). An empty page ends the query whatever its page info says, so zero is
 * read there; a page with posts that claims no pages is still malformed.
 */
function lastPageMinimumFor(articleCount: number): number {
  return articleCount === 0 ? 0 : 1
}

export function parseCafeBoardSearchList(value: unknown): CollectedArticlePage {
  const response = record(value, 'response', 'INVALID_ENVELOPE')
  const result = record(response.result, 'response.result', 'INVALID_ENVELOPE')
  if (!Array.isArray(result.articleList)) fail('INVALID_ENVELOPE', 'result.articleList must be an array')
  const items = result.articleList.map((entry, index) => parseSearchArticle(entry, index))
  return collectedArticlePage(items, result.pageInfo, lastPageMinimumFor(items.length))
}

export function parseCafeBoardSearchListText(text: string): CollectedArticlePage {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('INVALID_JSON', 'board-search response is not valid JSON')
  }
  return parseCafeBoardSearchList(value)
}
