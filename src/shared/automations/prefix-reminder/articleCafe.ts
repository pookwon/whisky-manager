import type { HttpRequest } from '../../http.js'
import type { SourceRef } from '../../protocol.js'
import type { CommentAuthor } from '../../types.js'

/**
 * Addresses and payloads for ordinary cafe articles, which the prefix reminder
 * automation comments on.
 *
 * This is not the memo board the welcome comment automation uses: different
 * hosts, different body encoding, and no success flag in the answer. The
 * capture that settles every constant here is
 * `docs/superpowers/specs/2026-09-12-cafe-article-comment-contract.md`.
 *
 * Pure functions over strings, like `welcome-comment/cafe.ts`: nothing here
 * fetches, so every value can be tested against the real capture.
 */
const CAFE_ORIGIN = 'https://cafe.naver.com'
const ARTICLE_ORIGIN = 'https://article.cafe.naver.com'

/**
 * Both endpoints answer an error page without it. The value names the surface
 * the capture was taken from, and the desktop only ever acts as that surface.
 */
const CAFE_PRODUCT_HEADER: Readonly<Record<string, string>> = { 'x-cafe-product': 'pc' }

/**
 * `access-control-allow-origin` on the read is `https://cafe.naver.com` alone,
 * so the request has to look like it came from the article page. The extension
 * sets `origin` from the referer for exactly this reason.
 */
function articlePageUrl(source: SourceRef, postId: string): string {
  return `${CAFE_ORIGIN}/ca-fe/cafes/${source.cafeId}/articles/${postId}`
}

export function articleCommentListUrl(source: SourceRef, postId: string, page: number): string {
  return (
    `${ARTICLE_ORIGIN}/gw/v4/cafes/${source.cafeId}/articles/${postId}/comments/pages/${page}` +
    `?requestFrom=A&orderBy=asc`
  )
}

/**
 * The first page is the whole question we ask. We only want to know whether the
 * operator has already commented, and a post with enough comments to push that
 * onto a second page is not one this automation should be reminding anybody
 * about. Reading one page is the decision the contract records, not a limit of
 * the parser.
 */
const FIRST_PAGE = 1

export function articleCommentListRequest(source: SourceRef, postId: string): HttpRequest {
  return {
    url: articleCommentListUrl(source, postId, FIRST_PAGE),
    referer: articlePageUrl(source, postId),
    headers: CAFE_PRODUCT_HEADER,
  }
}

export const articleCommentPostUrl = 'https://apis.naver.com/cafe-web/cafe-mobile/CommentPost.json'

/**
 * What a browser sends for a form post — no charset parameter. The endpoint
 * reads the body as UTF-8, which is the one field-level difference from the
 * memo board: there the same header means MS949.
 */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded'

/**
 * Five fields, in the order the capture sent them. `menuId` is deliberately
 * absent: the write does not take it, only the delete does.
 *
 * Encoded field by field rather than with `URLSearchParams`, which spells a
 * space as `+`. Both are legal form encoding and the endpoint would almost
 * certainly take either, but the capture is what we know to work and this is
 * an undocumented endpoint — so the bytes match it exactly.
 */
export function articleCommentWriteRequest(source: SourceRef, postId: string, content: string): HttpRequest {
  const body = [
    ['content', content],
    ['stickerId', ''],
    ['cafeId', source.cafeId],
    ['articleId', postId],
    ['requestFrom', 'A'],
  ]
    .map(([field, value]) => `${field}=${encodeURIComponent(value ?? '')}`)
    .join('&')
  return {
    url: articleCommentPostUrl,
    method: 'POST',
    body,
    contentType: FORM_CONTENT_TYPE,
    referer: articlePageUrl(source, postId),
    headers: CAFE_PRODUCT_HEADER,
  }
}

interface RawWriter {
  readonly nick?: unknown
  readonly memberKey?: unknown
}

interface RawComment {
  readonly writer?: RawWriter
  readonly isDeleted?: unknown
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export interface ArticleCommentPage {
  /**
   * The member the browser session belongs to, as this very response names it.
   * A write is confirmed by finding this key among the writers afterwards, so
   * reading the comments answers "who am I" and "who commented" at once — the
   * article endpoints never need the memo board's login page for either.
   */
  readonly viewerMemberKey: string | null
  readonly authors: CommentAuthor[]
}

/**
 * `null` means the page could not be read, which is not the same as nobody
 * having commented. A post with no comments answers with an empty `items`, and
 * that is precisely the post this automation exists to remind — collapsing the
 * two would skip every one of them.
 *
 * There is no success field in this response, so the shape is the test:
 * `result.comments.items` being an array is what a real answer has and a login
 * or error page does not.
 */
export function parseArticleCommentPage(body: string): ArticleCommentPage | null {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null

  const result = (payload as { result?: { comments?: { items?: unknown }; user?: { memberKey?: unknown } } }).result
  const items = result?.comments?.items
  if (!Array.isArray(items)) return null

  const viewerMemberKey = result?.user?.memberKey
  return {
    viewerMemberKey: typeof viewerMemberKey === 'string' && viewerMemberKey !== '' ? viewerMemberKey : null,
    // A deleted comment drops out of the list entirely; the flag is here for the
    // shell Naver may leave behind when a reply hangs off it. Either way its
    // writer is not someone who has commented on this post.
    authors: (items as RawComment[])
      .filter((comment) => comment.isDeleted !== true)
      .map((comment) => ({
        nickname: asString(comment.writer?.nick),
        memberKey: asString(comment.writer?.memberKey),
      })),
  }
}

export function parseArticleCommentAuthors(body: string): CommentAuthor[] | null {
  return parseArticleCommentPage(body)?.authors ?? null
}
