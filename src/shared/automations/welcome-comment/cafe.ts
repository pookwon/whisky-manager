import { encodeFormBody } from '../../cp949.js'
import type { SourceRef } from '../../protocol.js'
import type { CommentAuthor } from '../../types.js'

/**
 * Addresses and payloads for the memo board the 가입인사 automation works on.
 *
 * Everything here is a pure function over strings so it can be tested against
 * real captures. The extension supplies the session; nothing in this file
 * fetches. Endpoints were read out of the board's own page script rather than
 * guessed — see the design spec, section 5.8.
 */
const ORIGIN = 'https://cafe.naver.com'

export function memoListUrl(source: SourceRef, page: number): string {
  // `viewType=pc` is what returns the server-rendered list rather than a shell.
  return (
    `${ORIGIN}/MemoList.nhn?search.clubid=${source.cafeId}` +
    `&search.menuid=${source.boardId}&search.page=${page}&viewType=pc`
  )
}

export function commentViewUrl(source: SourceRef, postId: string): string {
  return (
    `${ORIGIN}/MemoCommentView.nhn?search.clubid=${source.cafeId}` +
    `&search.menuid=${source.boardId}&search.articleid=${postId}&search.lastpageview=true&lcs=Y`
  )
}

export const commentPostUrl = `${ORIGIN}/MemoCommentPost.nhn`

interface RawComment {
  readonly writernick?: unknown
  readonly writerMemberKey?: unknown
  readonly deleted?: unknown
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * `null` means the thread could not be read, which is not the same as nobody
 * having commented. An empty list clears a post for a greeting; a failed read
 * must not, so the two never collapse into one another.
 */
export function parseCommentAuthors(body: string): CommentAuthor[] | null {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null

  const envelope = payload as { isSuccess?: unknown; result?: { list?: unknown } }
  // The cafe reports success as the string "true", not a boolean.
  if (String(envelope.isSuccess) !== 'true') return null

  const list = envelope.result?.list
  if (!Array.isArray(list)) return null

  return (list as RawComment[])
    .filter((comment) => comment.deleted !== true)
    .map((comment) => ({
      nickname: asString(comment.writernick),
      memberKey: asString(comment.writerMemberKey),
    }))
}

export interface LoginState {
  readonly loggedIn: boolean
  readonly account: string | null
  readonly memberKey: string | null
}

const USER_ID = /var\s+g_sUserId\s*=\s*"([^"]*)"/
const USER_MEMBER_KEY = /var\s+g_sUserMemberKey\s*=\s*"([^"]*)"/

const LOGGED_OUT: LoginState = { loggedIn: false, account: null, memberKey: null }

/**
 * The board page itself names the signed-in account, so the login check reads
 * the same page collection does. Naver serves a page to anonymous visitors as
 * well, so the signal is the account being named, not the page loading. Anything unrecognised counts
 * as logged out: greeting nobody costs a session, whereas parsing a login page
 * as a board is the accident section 5.6 exists to prevent.
 */
export function parseLoginState(html: string): LoginState {
  const account = USER_ID.exec(html)?.[1] ?? ''
  if (account === '') return LOGGED_OUT
  return { loggedIn: true, account, memberKey: USER_MEMBER_KEY.exec(html)?.[1] ?? null }
}

/**
 * Mirrors the hidden form the board posts comments with, field for field. The
 * empty ones are sent because the page sends them, and the text is CP949 —
 * these endpoints decode request parameters as MS949, not UTF-8.
 */
export function commentPostBody(source: SourceRef, postId: string, content: string): string {
  return encodeFormBody({
    content,
    clubid: source.cafeId,
    menuid: source.boardId,
    articleid: postId,
    m: 'write',
    commentid: '',
    refcommentid: '',
    emotion: '11',
    orderby: '',
    replyToMemberKey: '',
    replyToNick: '',
    csKey: '',
    csValue: '',
    branchCode: '',
    stickerId: '',
    imagePath: '',
    imageFileName: '',
    imageWidth: '',
    imageHeight: '',
  })
}
