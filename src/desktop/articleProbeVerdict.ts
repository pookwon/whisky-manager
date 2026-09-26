import type { CollectedPostMetadata } from '../shared/cafeArticleList.js'
import type { CafeArticleRead } from '../shared/cafeArticleRead.js'
import { CollectionPageError } from './collectionPageError.js'

/** What one id turned out to be. `post` null: the id was already stored when its turn came, and nothing is written. */
export type ArticleProbeVerdict =
  | { readonly outcome: 'stored'; readonly boardId: string; readonly post: CollectedPostMetadata | null }
  | { readonly outcome: 'other_board'; readonly boardId: string }
  /** A live notice: recorded with its board, never stored — the list walks store no notice. */
  | { readonly outcome: 'notice'; readonly boardId: string }
  | { readonly outcome: 'deleted' }
  | { readonly outcome: 'unreadable'; readonly errorCode: string }

/**
 * The refusals the capture (2026-09-26) settled, each with the status it came
 * with. Nothing else is guessed at: a changed contract read as "unreadable"
 * would close thousands of ids in silence, so an answer outside this table
 * ends the block and names itself in the run's stop reason.
 */
const KNOWN_REFUSALS: ReadonlyArray<{ readonly status: number; readonly code: string; readonly outcome: 'deleted' | 'unreadable' }> = [
  { status: 404, code: '4003', outcome: 'deleted' },
  // A per-board restriction of this read, answered to the signed-in session too (937311, board 207).
  { status: 401, code: '0004', outcome: 'unreadable' },
]

export function judgeArticleRead(postId: string, read: CafeArticleRead, collectedBoardIds: ReadonlySet<string>): ArticleProbeVerdict {
  if (read.kind === 'article') {
    const { post } = read
    // Before the board: a notice is not stored whichever board it is on.
    if (read.isNotice) return { outcome: 'notice', boardId: post.boardId }
    return collectedBoardIds.has(post.boardId) ? { outcome: 'stored', boardId: post.boardId, post } : { outcome: 'other_board', boardId: post.boardId }
  }
  const known = KNOWN_REFUSALS.find((refusal) => refusal.status === read.status && refusal.code === read.code)
  if (known === undefined) throw new CollectionPageError('ARTICLE_PROBE_UNKNOWN_ANSWER', `id ${postId} ${read.status} ${read.code}`)
  return known.outcome === 'deleted' ? { outcome: 'deleted' } : { outcome: 'unreadable', errorCode: read.code }
}
