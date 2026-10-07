import {
  epochMilliseconds,
  fail,
  nullableString,
  prefixOf,
  record,
  safeInteger,
  type CollectedPostMetadata,
} from './cafeArticleList.js'
import { cafeCount } from './cafeCount.js'

/**
 * Pure contract for one article read by id (captured 2026-09-26). Its `article`
 * is the object the comment read carries too: the board is `menu`, the prefix
 * `head`, the time `writeDate` in epoch ms, and the subject plain text — no
 * search highlight. A malformed answer fails loudly: judging it would close an
 * id that was never really read.
 */

/**
 * The post, and whether the cafe calls it a notice. The flag sits beside the
 * post rather than in it: `CollectedPostMetadata` is the list's row, where a
 * notice never appears, and the desktop decides what a notice read by id means.
 */
export interface ParsedCafeArticle {
  readonly post: CollectedPostMetadata
  readonly isNotice: boolean
}

export type CafeArticleRead =
  | ({ readonly kind: 'article' } & ParsedCafeArticle)
  /** The cafe answered and said why there is no post: its own code, with the HTTP status it came with. */
  | { readonly kind: 'absent'; readonly status: number; readonly code: string }

const PATH = 'result.article'

export function parseCafeArticle(postId: string, value: unknown): ParsedCafeArticle {
  const response = record(value, 'response', 'INVALID_ENVELOPE')
  const result = record(response.result, 'response.result', 'INVALID_ENVELOPE')
  const article = record(result.article, PATH, 'INVALID_ARTICLE')
  const menu = record(article.menu, `${PATH}.menu`, 'INVALID_ARTICLE')
  const writer = record(article.writer, `${PATH}.writer`, 'INVALID_ARTICLE')
  const id = String(safeInteger(article, 'id', PATH, 1, 'INVALID_ARTICLE'))
  if (id !== postId) fail('INVALID_ARTICLE', `${PATH}.id ${id} is not the article asked for`)
  const boardName = nullableString(menu, 'name', `${PATH}.menu`, 'INVALID_ARTICLE')
  if (boardName === null) fail('INVALID_ARTICLE', `${PATH}.menu.name must not be null`)
  const isNotice = article.isNotice
  if (typeof isNotice !== 'boolean') fail('INVALID_ARTICLE', `${PATH}.isNotice must be a boolean`)
  const post: CollectedPostMetadata = {
    cafeId: String(safeInteger(result, 'cafeId', 'result', 1, 'INVALID_ENVELOPE')),
    postId: id,
    boardId: String(safeInteger(menu, 'id', `${PATH}.menu`, 1, 'INVALID_ARTICLE')),
    boardName,
    title: nullableString(article, 'subject', PATH, 'INVALID_ARTICLE'),
    // A post without a prefix leaves `head` out, and `headId` out (seen live, 928665)
    // or 0 (the list's other spelling). A non-zero `headId` without its name is neither.
    prefix: prefixOf(article, PATH, 'head'),
    authorId: nullableString(writer, 'memberKey', `${PATH}.writer`, 'INVALID_ARTICLE'),
    authorNickname: nullableString(writer, 'nick', `${PATH}.writer`, 'INVALID_ARTICLE'),
    postedAt: epochMilliseconds(article, 'writeDate', PATH),
    viewCount: cafeCount(article, 'readCount', PATH, 'INVALID_ARTICLE'),
    commentCount: cafeCount(article, 'commentCount', PATH, 'INVALID_ARTICLE'),
    replyCount: null,
    // The list's row never holds a notice; whether this one is rides beside it.
    isNotice: false,
  }
  return { post, isNotice }
}

export function parseCafeArticleText(postId: string, text: string): ParsedCafeArticle {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('INVALID_JSON', 'article response is not valid JSON')
  }
  return parseCafeArticle(postId, value)
}

/**
 * The cafe's own code in a refusal (`4003` deleted, `0004` not readable on this
 * board — answered for posts the list walk stores, so not a login failure), or
 * null when the body names none — an HTML error page, an empty body. What a
 * code means is the desktop's judgement, not the transport's.
 */
export function cafeRefusalCode(text: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const result = (value as { result?: unknown }).result
  if (typeof result !== 'object' || result === null) return null
  const code = (result as { errorCode?: unknown }).errorCode
  return typeof code === 'string' && code !== '' ? code : null
}
