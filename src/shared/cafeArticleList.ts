/**
 * Pure contract for the menu=0 article-list response captured in Phase 0.
 * This module deliberately knows neither how a response is fetched nor where
 * its results are stored; both boundaries need a malformed response to fail
 * loudly instead of looking like an empty, successful page.
 */

export interface CollectedPostMetadata {
  readonly cafeId: string
  readonly postId: string
  readonly boardId: string
  /** Null when the list did not name it, which a board's own list never does. */
  readonly boardName: string | null
  readonly title: string | null
  readonly prefix: string | null
  readonly authorId: string | null
  readonly authorNickname: string | null
  /** Exact UTC epoch milliseconds from `writeDateTimestamp`. */
  readonly postedAt: number
  readonly viewCount: number
  readonly commentCount: number
  readonly replyCount: number
  /** `notices` is a separate endpoint, so an `ARTICLE` row is never a notice. */
  readonly isNotice: false
}

export interface CafeArticlePageInfo {
  readonly lastNavigationPageNumber: number
  readonly visibleNextButton: boolean
  /** The whole-cafe list reports it; a board's own list does not. */
  readonly totalArticleCount: number | null
}

export interface CollectedArticlePage {
  readonly items: readonly CollectedPostMetadata[]
  readonly pageInfo: CafeArticlePageInfo
  /** Versioned identity of the page's sorted ordinary-post IDs. */
  readonly pageIdentity: string
}

/**
 * Stamped on every observation this parser produces. Bump it when the mapping
 * changes, so rows read under two different readings of the same response are
 * told apart afterwards rather than averaged together.
 */
export const CAFE_ARTICLE_LIST_PARSER_VERSION = 'article-list-v1'

export type CafeArticleListParseErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_ENVELOPE'
  | 'INVALID_PAGE_INFO'
  | 'INVALID_ARTICLE'
  | 'UNEXPECTED_LIST_ENTRY_TYPE'
  | 'DUPLICATE_POST_ID'

export class CafeArticleListParseError extends Error {
  constructor(
    readonly code: CafeArticleListParseErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CafeArticleListParseError'
  }
}

type JsonRecord = Record<string, unknown>

const MAX_DATE_MS = 8_640_000_000_000_000
const MIN_EPOCH_MILLISECONDS = 1_000_000_000_000
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const FNV_MASK = 0xffffffffffffffffn

function fail(code: CafeArticleListParseErrorCode, message: string): never {
  throw new CafeArticleListParseError(code, message)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, path: string, code: CafeArticleListParseErrorCode): JsonRecord {
  if (!isRecord(value)) fail(code, `${path} must be an object`)
  return value
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function nullableString(record: JsonRecord, key: string, path: string, code: CafeArticleListParseErrorCode): string | null {
  if (!hasOwn(record, key)) fail(code, `${path}.${key} is missing`)
  const value = record[key]
  if (value === null || typeof value === 'string') return value
  return fail(code, `${path}.${key} must be a string or null`)
}

function optionalNullableString(record: JsonRecord, key: string, path: string, code: CafeArticleListParseErrorCode): string | null | undefined {
  if (!hasOwn(record, key)) return undefined
  return nullableString(record, key, path, code)
}

function safeInteger(
  record: JsonRecord,
  key: string,
  path: string,
  minimum: number,
  code: CafeArticleListParseErrorCode,
): number {
  if (!hasOwn(record, key)) fail(code, `${path}.${key} is missing`)
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    fail(code, `${path}.${key} must be a safe integer at least ${minimum}`)
  }
  return value
}

function epochMilliseconds(record: JsonRecord, key: string, path: string): number {
  const value = safeInteger(record, key, path, MIN_EPOCH_MILLISECONDS, 'INVALID_ARTICLE')
  if (value > MAX_DATE_MS) fail('INVALID_ARTICLE', `${path}.${key} is outside the Date range`)
  return value
}

function titleOf(item: JsonRecord, path: string): string | null {
  const subject = optionalNullableString(item, 'subject', path, 'INVALID_ARTICLE')
  const title = optionalNullableString(item, 'title', path, 'INVALID_ARTICLE')
  if (subject === undefined && title === undefined) fail('INVALID_ARTICLE', `${path}.subject or ${path}.title is required`)
  return subject ?? title ?? null
}

function authorNicknameOf(item: JsonRecord, writerInfo: JsonRecord, path: string): string | null {
  const nested = optionalNullableString(writerInfo, 'nickName', `${path}.writerInfo`, 'INVALID_ARTICLE')
  if (nested !== undefined) return nested
  const fallback = optionalNullableString(item, 'writerNickname', path, 'INVALID_ARTICLE')
  if (fallback === undefined) fail('INVALID_ARTICLE', `${path}.writerInfo.nickName or ${path}.writerNickname is required`)
  return fallback
}

function prefixOf(item: JsonRecord, path: string): string | null {
  const headName = optionalNullableString(item, 'headName', path, 'INVALID_ARTICLE')
  if (headName !== undefined) return headName
  // A post with no prefix always omits `headName`, and reports `headId` either
  // by omitting it too or as 0 — both spellings appear in one live page. A
  // present, non-zero headId without its name is neither, and is rejected so a
  // renamed prefix field cannot pass as a post that never had one.
  if (!hasOwn(item, 'headId') || item.headId === null || item.headId === 0) return null
  fail('INVALID_ARTICLE', `${path}.headName is missing for a headed article`)
}

function parseArticle(entry: unknown, index: number): CollectedPostMetadata {
  const path = `result.articleList[${index}]`
  const rawEntry = record(entry, path, 'INVALID_ARTICLE')
  if (rawEntry.type !== 'ARTICLE') {
    // The dedicated notices endpoint is not part of this response. If that
    // contract changes, rejecting the whole page prevents a silent omission.
    fail('UNEXPECTED_LIST_ENTRY_TYPE', `${path}.type must be ARTICLE`)
  }
  const item = record(rawEntry.item, `${path}.item`, 'INVALID_ARTICLE')
  const writerInfo = record(item.writerInfo, `${path}.item.writerInfo`, 'INVALID_ARTICLE')

  const prefix = prefixOf(item, `${path}.item`)
  // The whole-cafe list names each item's board; a board's own list, where
  // every item is that board's, leaves it out. Present-but-null is still a
  // fault: the field was sent and says nothing.
  const boardName = optionalNullableString(item, 'menuName', `${path}.item`, 'INVALID_ARTICLE')
  if (boardName === null) fail('INVALID_ARTICLE', `${path}.item.menuName must not be null`)
  return {
    cafeId: String(safeInteger(item, 'cafeId', `${path}.item`, 1, 'INVALID_ARTICLE')),
    postId: String(safeInteger(item, 'articleId', `${path}.item`, 1, 'INVALID_ARTICLE')),
    boardId: String(safeInteger(item, 'menuId', `${path}.item`, 0, 'INVALID_ARTICLE')),
    boardName: boardName ?? null,
    title: titleOf(item, `${path}.item`),
    prefix,
    authorId: nullableString(writerInfo, 'memberKey', `${path}.item.writerInfo`, 'INVALID_ARTICLE'),
    authorNickname: authorNicknameOf(item, writerInfo, `${path}.item`),
    postedAt: epochMilliseconds(item, 'writeDateTimestamp', `${path}.item`),
    viewCount: safeInteger(item, 'readCount', `${path}.item`, 0, 'INVALID_ARTICLE'),
    commentCount: safeInteger(item, 'commentCount', `${path}.item`, 0, 'INVALID_ARTICLE'),
    replyCount: safeInteger(item, 'replyArticleCount', `${path}.item`, 0, 'INVALID_ARTICLE'),
    isNotice: false,
  }
}

function parsePageInfo(value: unknown): CafeArticlePageInfo {
  const pageInfo = record(value, 'result.pageInfo', 'INVALID_PAGE_INFO')
  const visibleNextButton = pageInfo.visibleNextButton
  if (typeof visibleNextButton !== 'boolean') {
    fail('INVALID_PAGE_INFO', 'result.pageInfo.visibleNextButton must be a boolean')
  }
  return {
    lastNavigationPageNumber: safeInteger(pageInfo, 'lastNavigationPageNumber', 'result.pageInfo', 1, 'INVALID_PAGE_INFO'),
    visibleNextButton,
    totalArticleCount: pageInfo.totalArticleCount === undefined ? null : safeInteger(pageInfo, 'totalArticleCount', 'result.pageInfo', 0, 'INVALID_PAGE_INFO'),
  }
}

/**
 * FNV-1a 64 over `article-page-v1\\0` and the post IDs sorted by code unit and
 * separated by NUL. Each ECMAScript Unicode code point is one FNV input. It is
 * deliberately implemented with only ECMAScript primitives, so browser
 * extension and Node code always agree. An empty list
 * has a valid, distinct identity; whether it terminates collection is owned by
 * the later orchestration layer.
 */
export function cafeArticlePageIdentity(postIds: readonly string[]): string {
  const canonical = `article-page-v1\u0000${[...postIds].sort().join('\u0000')}`
  let hash = FNV_OFFSET_BASIS
  for (const character of canonical) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = (hash * FNV_PRIME) & FNV_MASK
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

/** Parses a decoded JSON value from the exact list endpoint. */
export function parseCafeArticleList(value: unknown): CollectedArticlePage {
  const response = record(value, 'response', 'INVALID_ENVELOPE')
  const result = record(response.result, 'response.result', 'INVALID_ENVELOPE')
  if (!Array.isArray(result.articleList)) fail('INVALID_ENVELOPE', 'result.articleList must be an array')

  const items = result.articleList.map((entry, index) => parseArticle(entry, index))
  const postIds = new Set<string>()
  for (const item of items) {
    if (postIds.has(item.postId)) fail('DUPLICATE_POST_ID', `result.articleList has duplicate articleId ${item.postId}`)
    postIds.add(item.postId)
  }
  return { items, pageInfo: parsePageInfo(result.pageInfo), pageIdentity: cafeArticlePageIdentity(items.map((item) => item.postId)) }
}

/** Parses decoded response text without treating HTML/login pages as an empty list. */
export function parseCafeArticleListText(text: string): CollectedArticlePage {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('INVALID_JSON', 'article-list response is not valid JSON')
  }
  return parseCafeArticleList(value)
}
