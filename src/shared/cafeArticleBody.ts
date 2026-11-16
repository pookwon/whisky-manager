import { epochMilliseconds, fail, nullableString, record, safeInteger } from './cafeArticleList.js'

/**
 * Pure contract for the body of one article read by id. It reads the same
 * `result.article` envelope as `parseCafeArticle`, but keeps only what judging
 * an attendance round needs: the id it was asked for, the subject, the write
 * time in epoch ms, and the post's HTML. A malformed answer fails loudly, so an
 * id is never closed on a body that was never really read.
 */

export interface CafeArticleBody {
  readonly postId: string
  readonly title: string | null
  readonly postedAt: number // epoch ms
  readonly contentHtml: string
}

export type CafeArticleBodyRead =
  | ({ readonly kind: 'article' } & CafeArticleBody)
  /** The cafe answered and said why there is no post: its own code, with the HTTP status it came with. */
  | { readonly kind: 'absent'; readonly status: number; readonly code: string }

const PATH = 'result.article'

export function parseCafeArticleBody(postId: string, value: unknown): CafeArticleBody {
  const response = record(value, 'response', 'INVALID_ENVELOPE')
  const result = record(response.result, 'response.result', 'INVALID_ENVELOPE')
  const article = record(result.article, PATH, 'INVALID_ARTICLE')
  const id = String(safeInteger(article, 'id', PATH, 1, 'INVALID_ARTICLE'))
  if (id !== postId) fail('INVALID_ARTICLE', `${PATH}.id ${id} is not the article asked for`)
  const contentHtml = nullableString(article, 'contentHtml', PATH, 'INVALID_ARTICLE')
  if (contentHtml === null) fail('INVALID_ARTICLE', `${PATH}.contentHtml must be a string`)
  return {
    postId: id,
    title: nullableString(article, 'subject', PATH, 'INVALID_ARTICLE'),
    postedAt: epochMilliseconds(article, 'writeDate', PATH),
    contentHtml,
  }
}

export function parseCafeArticleBodyText(postId: string, text: string): CafeArticleBody {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('INVALID_JSON', 'article response is not valid JSON')
  }
  return parseCafeArticleBody(postId, value)
}
