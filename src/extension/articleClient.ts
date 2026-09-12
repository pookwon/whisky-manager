import {
  articleCommentListRequest,
  articleCommentWriteRequest,
  parseArticleCommentPage,
} from '../shared/automations/prefix-reminder/articleCafe.js'
import type { Http } from '../shared/http.js'
import type { SourceRef } from '../shared/protocol.js'
import type { CommentAuthor } from '../shared/types.js'
import { diagnose, type ExecuteResult } from './cafeClient.js'

export interface ArticleClientDeps {
  readonly http: Http
  /**
   * Runs in the cafe page's JavaScript context immediately before the write,
   * where Naver's `lcs_do` records the interaction. Same hook, same reason as
   * the memo board client.
   */
  readonly beforeCommentPost?: (source: SourceRef, postId: string) => Promise<void>
}

export interface ArticleClient {
  checkComments(source: SourceRef, postId: string): Promise<CommentAuthor[] | null>
  execute(source: SourceRef, postId: string, content: string): Promise<ExecuteResult>
}

/**
 * Comments on ordinary cafe articles.
 *
 * It takes no login argument and asks no login page. The comment response names
 * the member the session belongs to, so the read this client already makes
 * before writing proves the session as well — and it is that same key the
 * re-read has to find afterwards. The memo board needs its own login check
 * because its comment endpoint names nobody; this one does not.
 */
export function createArticleClient(deps: ArticleClientDeps): ArticleClient {
  async function readPage(source: SourceRef, postId: string) {
    const response = await deps.http(articleCommentListRequest(source, postId))
    return response.status === 200 ? parseArticleCommentPage(response.text) : null
  }

  return {
    async checkComments(source, postId) {
      return (await readPage(source, postId))?.authors ?? null
    },

    async execute(source, postId, content) {
      // Reading first answers two questions with one request: who we are, and
      // whether the write is even worth attempting. Posting while signed out
      // would be answered with a page that claims nothing went wrong.
      const before = await readPage(source, postId)
      if (before === null) {
        return { ok: false, commentAuthors: null, error: 'COMMENT_CHECK_FAILED', diagnostic: null }
      }
      if (before.viewerMemberKey === null) {
        return { ok: false, commentAuthors: null, error: 'NOT_LOGGED_IN', diagnostic: null }
      }

      await deps.beforeCommentPost?.(source, postId)
      const posted = await deps.http(articleCommentWriteRequest(source, postId, content))
      if (posted.status !== 200) {
        return {
          ok: false,
          commentAuthors: null,
          error: `POST_FAILED_${posted.status}`,
          diagnostic: diagnose(posted.text),
        }
      }

      // The answer carries a comment id, which says a request was accepted, not
      // that a comment exists. Reading it back is the only proof, and it also
      // settles the case where a timed-out request actually landed.
      const after = await readPage(source, postId)
      if (after === null) {
        return {
          ok: false,
          commentAuthors: null,
          error: 'COMMENT_CHECK_FAILED',
          diagnostic: diagnose(posted.text),
        }
      }
      const landed = after.authors.some((author) => author.memberKey === before.viewerMemberKey)
      return {
        ok: landed,
        commentAuthors: after.authors,
        error: landed ? null : 'COMMENT_NOT_VISIBLE',
        diagnostic: landed ? null : diagnose(posted.text),
      }
    },
  }
}
