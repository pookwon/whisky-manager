import {
  commentPostBody,
  commentPostUrl,
  commentViewUrl,
  memoListUrl,
  parseCommentAuthors,
  parseLoginState,
  type LoginState,
} from '../shared/automations/welcome-comment/cafe.js'
import { parseMemoList } from '../shared/automations/welcome-comment/parse.js'
import { comparePostId } from '../shared/postId.js'
import type { RawCandidate, SourceRef } from '../shared/protocol.js'
import type { CommentAuthor } from '../shared/types.js'

export interface HttpRequest {
  readonly url: string
  readonly method?: 'GET' | 'POST'
  readonly body?: string
  readonly contentType?: string
  /** Page this request should appear to come from. See `execute`. */
  readonly referer?: string
}

export interface HttpResponse {
  readonly status: number
  readonly contentType: string | null
  /** Already decoded with the charset the response declared. */
  readonly text: string
}

export type Http = (request: HttpRequest) => Promise<HttpResponse>

export interface CafeClientDeps {
  readonly http: Http
  /**
   * Runs in the board page's JavaScript context immediately before the form
   * write. Naver's `lcs_do` records the interaction there.
   */
  readonly beforeCommentPost?: (source: SourceRef, postId: string) => Promise<void>
}

export interface ExecuteResult {
  readonly ok: boolean
  readonly commentAuthors: CommentAuthor[] | null
  readonly error: string | null
  /** A slice of the endpoint's answer, kept only when execution failed. */
  readonly diagnostic: string | null
}

export interface CafeClient {
  checkLogin(source: SourceRef): Promise<LoginState>
  collect(source: SourceRef, sincePostId: string | null, sincePostedAt: number | null): Promise<RawCandidate[]>
  checkComments(source: SourceRef, postId: string): Promise<CommentAuthor[] | null>
  execute(source: SourceRef, postId: string, content: string): Promise<ExecuteResult>
}

/**
 * Log a warning when paging exceeds this count. This is not a hard stop — the
 * loop continues until the data itself ends (an empty page, or reaching the
 * watermark/time floor). A warning makes abnormally long fetches visible
 * without stopping them, which would hide a broken stop condition.
 */
const PAGES_WARNING_THRESHOLD = 50

/**
 * What a browser sends for a form post — no charset parameter. The page is
 * MS949 and the server assumes it, which is why the body is encoded that way;
 * announcing a charset here would differ from what the board itself sends.
 */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded'

/** Enough of a rejection page to recognise it, short enough to store. */
const DIAGNOSTIC_LENGTH = 300

function diagnose(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, DIAGNOSTIC_LENGTH)
}

function isNewerThan(watermark: string | null, postId: string): boolean {
  return watermark === null || comparePostId(postId, watermark) > 0
}

function oldestFirst(a: RawCandidate, b: RawCandidate): number {
  return comparePostId(a.postId, b.postId)
}

export function createCafeClient(deps: CafeClientDeps): CafeClient {
  let session: LoginState | null = null

  async function checkLogin(source: SourceRef): Promise<LoginState> {
    // The board's own page names the account, so one request proves both that
    // the session is live and that it can still reach this board.
    const response = await deps.http({ url: memoListUrl(source, 1) })
    session = parseLoginState(response.status === 200 ? response.text : '')
    return session
  }

  async function checkComments(source: SourceRef, postId: string): Promise<CommentAuthor[] | null> {
    const response = await deps.http({ url: commentViewUrl(source, postId) })
    return response.status === 200 ? parseCommentAuthors(response.text) : null
  }

  return {
    checkLogin,
    checkComments,

    async collect(source, sincePostId, sincePostedAt) {
      const collected = new Map<string, RawCandidate>()

      // When neither a watermark nor a time floor exists, read only the first
      // page to avoid walking the board's entire history on a fresh install.
      // When either exists, read until the stop condition (reaching the watermark/
      // floor, or reaching an empty page). Logs a warning past 50 pages if the
      // stop condition seems broken.
      const stopAtFirstPageOnly = sincePostId === null && sincePostedAt === null
      const useTimeFloor = sincePostId === null && sincePostedAt !== null

      for (let page = 1; ; page += 1) {
        if (page > PAGES_WARNING_THRESHOLD) {
          console.warn(`Post collection exceeded ${PAGES_WARNING_THRESHOLD} pages`)
        }

        if (stopAtFirstPageOnly && page > 1) break

        const response = await deps.http({ url: memoListUrl(source, page) })
        if (response.status !== 200) break

        const memos = parseMemoList(response.text)
        // No memos means this is not the board — a login or error page. Never
        // treat that as "nothing new", which would advance past real greetings.
        if (memos.length === 0) break

        let reachedFloor = false
        let added = 0
        for (const memo of memos) {
          // When using watermark: skip until newer than watermark
          if (sincePostId !== null) {
            if (!isNewerThan(sincePostId, memo.postId)) {
              reachedFloor = true
              continue
            }
          }
          // When using time floor: collect posts from today onwards, stop when older
          if (useTimeFloor) {
            // Stop if we reach a post older than the floor
            if (memo.postedAt < sincePostedAt) {
              reachedFloor = true
              // Do not collect this post, it's too old
              continue
            }
            // Post is from today onwards, collect it
          }
          if (collected.has(memo.postId)) continue
          collected.set(memo.postId, memo)
          added += 1
        }
        // Nothing new on a whole page means paging is not moving; stop rather
        // than walk to the ceiling.
        if (reachedFloor || added === 0) break
      }

      // Oldest first: a session that stops at its cap must leave the newest
      // behind, never the oldest, or the oldest are never greeted at all.
      return [...collected.values()].sort(oldestFirst)
    },

    async execute(source, postId, content) {
      const login = session ?? (await checkLogin(source))
      if (!login.loggedIn || login.memberKey === null) {
        return { ok: false, commentAuthors: null, error: 'NOT_LOGGED_IN', diagnostic: null }
      }

      // The board posts comments by submitting a hidden form, so the request
      // carries the board page as its referer. The form has no csrf token,
      // which leaves the referer as the check the server can still make — a
      // fetch without one is answered with 200 and quietly does nothing.
      await deps.beforeCommentPost?.(source, postId)
      const posted = await deps.http({
        url: commentPostUrl,
        method: 'POST',
        body: commentPostBody(source, postId, content),
        contentType: FORM_CONTENT_TYPE,
        referer: memoListUrl(source, 1),
      })
      if (posted.status !== 200) {
        return {
          ok: false,
          commentAuthors: null,
          error: `POST_FAILED_${posted.status}`,
          diagnostic: diagnose(posted.text),
        }
      }

      // The form endpoint answers with a page meant for a hidden iframe, so its
      // body proves nothing. Reading the comment back is the only proof, and it
      // also settles the case where a timed-out request actually landed.
      const authors = await checkComments(source, postId)
      if (authors === null) {
        return {
          ok: false,
          commentAuthors: null,
          error: 'COMMENT_CHECK_FAILED',
          diagnostic: diagnose(posted.text),
        }
      }
      const landed = authors.some((author) => author.memberKey === login.memberKey)
      return {
        ok: landed,
        commentAuthors: authors,
        error: landed ? null : 'COMMENT_NOT_VISIBLE',
        diagnostic: landed ? null : diagnose(posted.text),
      }
    },
  }
}
