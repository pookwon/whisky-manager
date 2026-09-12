import {
  articleCommentListRequest,
  articleCommentWriteRequest,
  parseArticleCommentPage,
  type ArticleCommentPage,
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

/** Whether the session's own member is among the people who commented. */
function wroteOneOf(page: ArticleCommentPage): boolean {
  return page.authors.some((author) => author.memberKey === page.viewerMemberKey)
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

      // Our own comment already on the post is a refusal, not a success. The
      // proof a write landed is our key appearing among the writers, and a key
      // that was there beforehand proves nothing — writing anyway would leave
      // a second reminder on a post already reminded and report it as fine.
      if (wroteOneOf(before)) {
        return { ok: false, commentAuthors: before.authors, error: 'ALREADY_COMMENTED', diagnostic: null }
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
      // Judged against the key we proved before writing, so a response that
      // names a different viewer cannot talk us into calling the write landed.
      const landed = wroteOneOf({ viewerMemberKey: before.viewerMemberKey, authors: after.authors })
      return {
        ok: landed,
        commentAuthors: after.authors,
        error: landed ? null : 'COMMENT_NOT_VISIBLE',
        diagnostic: landed ? null : diagnose(posted.text),
      }
    },
  }
}
