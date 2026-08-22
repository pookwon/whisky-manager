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
import { laterPostId } from '../shared/postId.js'
import type { RawCandidate, SourceRef } from '../shared/protocol.js'
import type { CommentAuthor } from '../shared/types.js'

export interface HttpRequest {
  readonly url: string
  readonly method?: 'GET' | 'POST'
  readonly body?: string
  readonly contentType?: string
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
}

export interface ExecuteResult {
  readonly ok: boolean
  readonly commentAuthors: CommentAuthor[] | null
  readonly error: string | null
}

export interface CafeClient {
  checkLogin(source: SourceRef): Promise<LoginState>
  collect(source: SourceRef, sincePostId: string | null): Promise<RawCandidate[]>
  checkComments(source: SourceRef, postId: string): Promise<CommentAuthor[] | null>
  execute(source: SourceRef, postId: string, content: string): Promise<ExecuteResult>
}

/**
 * One session's worth of paging. Every page looking new is what a lost
 * watermark or a long outage looks like, and without a ceiling that walks the
 * board's whole history.
 */
const MAX_PAGES = 10

/** Legacy cafe endpoints read request parameters as MS949, never as UTF-8. */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=MS949'

function isNewerThan(watermark: string | null, postId: string): boolean {
  return watermark === null || laterPostId(watermark, postId) !== watermark
}

function oldestFirst(a: RawCandidate, b: RawCandidate): number {
  return laterPostId(a.postId, b.postId) === b.postId ? -1 : 1
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

    async collect(source, sincePostId) {
      const collected = new Map<string, RawCandidate>()
      // A fresh install has no floor to page back to, and the board holds
      // hundreds of thousands of memos. One page is the whole first harvest.
      const pageLimit = sincePostId === null ? 1 : MAX_PAGES

      for (let page = 1; page <= pageLimit; page += 1) {
        const response = await deps.http({ url: memoListUrl(source, page) })
        if (response.status !== 200) break

        const memos = parseMemoList(response.text)
        // No memos means this is not the board — a login or error page. Never
        // treat that as "nothing new", which would advance past real greetings.
        if (memos.length === 0) break

        let reachedWatermark = false
        let added = 0
        for (const memo of memos) {
          if (!isNewerThan(sincePostId, memo.postId)) {
            reachedWatermark = true
            continue
          }
          if (collected.has(memo.postId)) continue
          collected.set(memo.postId, memo)
          added += 1
        }
        // Nothing new on a whole page means paging is not moving; stop rather
        // than walk to the ceiling.
        if (reachedWatermark || added === 0) break
      }

      // Oldest first: a session that stops at its cap must leave the newest
      // behind, never the oldest, or the oldest are never greeted at all.
      return [...collected.values()].sort(oldestFirst)
    },

    async execute(source, postId, content) {
      const login = session ?? (await checkLogin(source))
      if (!login.loggedIn || login.memberKey === null) {
        return { ok: false, commentAuthors: null, error: 'NOT_LOGGED_IN' }
      }

      const posted = await deps.http({
        url: commentPostUrl,
        method: 'POST',
        body: commentPostBody(source, postId, content),
        contentType: FORM_CONTENT_TYPE,
      })
      if (posted.status !== 200) {
        return { ok: false, commentAuthors: null, error: `POST_FAILED_${posted.status}` }
      }

      // The form endpoint answers with a page meant for a hidden iframe, so its
      // body proves nothing. Reading the comment back is the only proof, and it
      // also settles the case where a timed-out request actually landed.
      const authors = await checkComments(source, postId)
      if (authors === null) {
        return { ok: false, commentAuthors: null, error: 'COMMENT_CHECK_FAILED' }
      }
      const landed = authors.some((author) => author.memberKey === login.memberKey)
      return {
        ok: landed,
        commentAuthors: authors,
        error: landed ? null : 'COMMENT_NOT_VISIBLE',
      }
    },
  }
}
