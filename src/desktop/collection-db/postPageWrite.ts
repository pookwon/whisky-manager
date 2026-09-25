import { inArray, sql } from 'drizzle-orm'
import type { CollectedPostMetadata } from '../../shared/cafeArticleList.js'
import type { CollectionTransaction } from './memberPageWrite.js'
import { boards, posts } from './schema.js'

export type { CollectionTransaction } from './memberPageWrite.js'

export interface WrittenPostRows {
  readonly insertedPostCount: number
  readonly updatedPostCount: number
}

/**
 * Only items that name their board can teach the boards table anything. A
 * board's own list never names it, and that board is already known: the job
 * was made from the boards table in the first place.
 */
function boardRows(items: readonly CollectedPostMetadata[], observedAt: Date) {
  const rows = new Map<string, { boardId: string; name: string; firstSeenAt: Date; lastSeenAt: Date }>()
  for (const item of items) {
    if (item.boardName === null) continue
    rows.set(item.boardId, {
      boardId: item.boardId,
      name: item.boardName,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
    })
  }
  return [...rows.values()]
}

/**
 * Writes one page's posts, whichever walk read them. A post is the cafe's, not
 * the feed's: the list walk and the search walk reading the same post both
 * land on its one row, and a re-read updates it in place.
 */
export async function writePostRows(
  tx: CollectionTransaction,
  items: readonly CollectedPostMetadata[],
  observedAt: Date,
  runId: string,
): Promise<WrittenPostRows> {
  const existingRows = await tx
    .select({ postId: posts.postId })
    .from(posts)
    .where(inArray(posts.postId, items.map((item) => item.postId)))
  const existingPostIds = new Set(existingRows.map((row) => row.postId))
  const insertedPostCount = items.filter((item) => !existingPostIds.has(item.postId)).length

  const namedBoards = boardRows(items, observedAt)
  if (namedBoards.length > 0) {
    await tx
      .insert(boards)
      .values(namedBoards)
      .onConflictDoUpdate({
        target: boards.boardId,
        set: { name: sql`excluded.name`, lastSeenAt: observedAt },
      })
  }

  // The post and its reading are one row, so a re-read updates in
  // place: the counters move, and `firstSeenAt` stays what it was.
  await tx
    .insert(posts)
    .values(
      items.map((item) => ({
        postId: item.postId,
        boardId: item.boardId,
        title: item.title,
        prefix: item.prefix,
        authorNickname: item.authorNickname,
        authorId: item.authorId,
        postedAt: new Date(item.postedAt),
        viewCount: item.viewCount,
        commentCount: item.commentCount,
        snapshotAt: observedAt,
        firstSeenAt: observedAt,
        lastRunId: runId,
      })),
    )
    .onConflictDoUpdate({
      target: posts.postId,
      set: {
        boardId: sql`excluded.board_id`,
        title: sql`excluded.title`,
        prefix: sql`excluded.prefix`,
        authorNickname: sql`excluded.author_nickname`,
        authorId: sql`excluded.author_id`,
        postedAt: sql`excluded.posted_at`,
        viewCount: sql`excluded.view_count`,
        commentCount: sql`coalesce(excluded.comment_count, ${posts.commentCount})`,
        snapshotAt: observedAt,
        lastRunId: runId,
      },
    })

  return { insertedPostCount, updatedPostCount: items.length - insertedPostCount }
}
