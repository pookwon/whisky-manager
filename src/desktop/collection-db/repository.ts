import { and, eq, inArray, sql } from 'drizzle-orm'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../shared/cafeArticleList.js'
import type { CollectionDatabase } from './client.js'
import { boards, collectionRuns, feedState, posts } from './schema.js'

/**
 * Which feed of the cafe. The cafe itself is the database, so it is not part of
 * this: one collection database holds one cafe's feeds.
 */
export interface CollectionFeed {
  readonly feedKind: 'all_articles'
  readonly menuId: string
}

export interface CreateCollectionRunInput extends CollectionFeed {
  readonly id: string
  readonly runKind: 'development' | 'backfill' | 'incremental'
  /** Only an explicitly resumed, same-range run may retain its checkpoint. */
  readonly resumeFromCheckpoint: boolean
  readonly targetStartMs: number
  readonly targetEndMs: number
  readonly startedAt: Date
}

export interface FeedStateExpectation {
  readonly stateVersion: number
  readonly anchorPostId: string | null
}

export interface PersistCollectedPageInput {
  readonly feed: CollectionFeed
  readonly runId: string
  /** The desktop's fetch-start time, never a timestamp supplied by the extension. */
  readonly observedAt: Date
  readonly referencePage: number
  readonly expectedState: FeedStateExpectation
  readonly page: CollectedArticlePage
}

export type PersistCollectedPageResult =
  | {
      readonly kind: 'stored'
      readonly insertedPostCount: number
      readonly updatedPostCount: number
      readonly nextStateVersion: number
      readonly anchorPostId: string
    }
  | { readonly kind: 'conflict' }

export interface CollectionRepository {
  readFeedState(feed: CollectionFeed): Promise<CollectionFeedState | null>
  startRun(input: CreateCollectionRunInput): Promise<CollectionFeedState>
  recordPageRequest(id: string, phase: 'probe' | 'collection'): Promise<void>
  /**
   * Ends a run, and — when it ended by reaching the period's start — records
   * that on the feed in the same transaction. Two readers ask whether the job
   * is done (the scheduler and the screens), and a fact written in one place is
   * a fact they cannot disagree about.
   */
  finishRun(id: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  /** Marks runs left `running` by an abnormal exit as interrupted so the feed's single-running-run constraint stops blocking new runs. */
  reconcileOrphanedRuns(finishedAt: Date): Promise<number>
  persistPage(input: PersistCollectedPageInput): Promise<PersistCollectedPageResult>
}

export interface CollectionFeedState extends FeedStateExpectation {
  readonly targetStartMs: number
  readonly targetEndMs: number
  readonly referencePage: number | null
  readonly pageIdentity: string | null
  readonly anchorPostedAtMs: number | null
  /**
   * When the cursor last moved. How stale it is decides how hard the next run
   * has to look for its place: the feed drifts about eight pages a day.
   */
  readonly cursorUpdatedAtMs: number
  /** Whether a run has reached the period's start. Written, never inferred. */
  readonly complete: boolean
}

/** Thrown inside the transaction so every page write rolls back on CAS failure. */
class FeedStateConflictError extends Error {
  constructor() {
    super('collection feed state changed before this page could commit')
    this.name = 'FeedStateConflictError'
  }
}

function assertPersistablePage(input: PersistCollectedPageInput): readonly CollectedPostMetadata[] {
  if (!Number.isSafeInteger(input.referencePage) || input.referencePage < 1) {
    throw new Error('referencePage must be a positive safe integer')
  }
  if (!Number.isSafeInteger(input.expectedState.stateVersion) || input.expectedState.stateVersion < 0) {
    throw new Error('expected stateVersion must be a nonnegative safe integer')
  }
  if (input.page.items.length === 0) {
    throw new Error('an empty article page must be handled by collection orchestration, not persisted')
  }

  const postIds = new Set<string>()
  for (const item of input.page.items) {
    if (item.isNotice) throw new Error('notice rows are not valid collection page input')
    if (postIds.has(item.postId)) throw new Error(`page has duplicate postId ${item.postId}`)
    postIds.add(item.postId)
  }
  return input.page.items
}

function boardRows(items: readonly CollectedPostMetadata[], observedAt: Date) {
  const rows = new Map<string, { boardId: string; name: string; firstSeenAt: Date; lastSeenAt: Date }>()
  for (const item of items) {
    rows.set(item.boardId, {
      boardId: item.boardId,
      name: item.boardName,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
    })
  }
  return [...rows.values()]
}

export function createCollectionRepository(db: CollectionDatabase): CollectionRepository {
  return {
    async readFeedState(feed) {
      const state = await db
        .select({
          stateVersion: feedState.stateVersion,
          targetStartMs: feedState.targetStartMs,
          targetEndMs: feedState.targetEndMs,
          anchorPostId: feedState.anchorPostId,
          anchorPostedAt: feedState.anchorPostedAt,
          referencePage: feedState.referencePage,
          pageIdentity: feedState.pageIdentity,
          completedAt: feedState.completedAt,
          updatedAt: feedState.updatedAt,
        })
        .from(feedState)
        .where(and(eq(feedState.feedKind, feed.feedKind), eq(feedState.menuId, feed.menuId)))
        .limit(1)
      const row = state[0]
      if (row === undefined) return null
      return {
        ...row,
        anchorPostedAtMs: row.anchorPostedAt?.getTime() ?? null,
        cursorUpdatedAtMs: row.updatedAt.getTime(),
        complete: row.completedAt !== null,
      }
    },

    async startRun(input) {
      if (!Number.isSafeInteger(input.targetStartMs) || !Number.isSafeInteger(input.targetEndMs) || input.targetStartMs >= input.targetEndMs) {
        throw new Error('collection run target range must contain a positive interval')
      }
      return await db.transaction(async (tx) => {
        const inserted = await tx.insert(feedState).values({
          feedKind: input.feedKind, menuId: input.menuId,
          targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs,
          stateVersion: 0, updatedAt: input.startedAt,
        }).onConflictDoNothing().returning({ menuId: feedState.menuId })
        const rows = await tx.select().from(feedState).where(and(eq(feedState.feedKind, input.feedKind), eq(feedState.menuId, input.menuId))).for('update')
        const current = rows[0]
        if (current === undefined) throw new Error('collection feed state does not exist')
        const running = await tx.select({ id: collectionRuns.id }).from(collectionRuns).where(and(eq(collectionRuns.feedKind, input.feedKind), eq(collectionRuns.menuId, input.menuId), eq(collectionRuns.status, 'running'))).limit(1)
        if (running.length > 0) throw new Error('collection feed already has a running run')
        const rangeChanged = current.targetStartMs !== input.targetStartMs || current.targetEndMs !== input.targetEndMs
        if (input.resumeFromCheckpoint && rangeChanged) throw new Error('cannot resume a checkpoint for a different target range')
        const reset = !input.resumeFromCheckpoint && inserted.length === 0
        const state = reset
          ? (await tx.update(feedState).set({ targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs, stateVersion: current.stateVersion + 1, anchorPostId: null, anchorPostedAt: null, pageIdentity: null, referencePage: null, lastRunId: null, completedAt: null, updatedAt: input.startedAt }).where(and(eq(feedState.feedKind, input.feedKind), eq(feedState.menuId, input.menuId))).returning())[0]
          : current
        if (state === undefined) throw new Error('collection feed reset failed')
        await tx.insert(collectionRuns).values({
          id: input.id,
          feedKind: input.feedKind,
          menuId: input.menuId,
          runKind: input.runKind,
          targetStartMs: input.targetStartMs,
          targetEndMs: input.targetEndMs,
          status: 'running',
          startedAt: input.startedAt,
        })
        return {
          stateVersion: state.stateVersion,
          targetStartMs: state.targetStartMs,
          targetEndMs: state.targetEndMs,
          anchorPostId: state.anchorPostId,
          anchorPostedAtMs: state.anchorPostedAt?.getTime() ?? null,
          referencePage: state.referencePage,
          pageIdentity: state.pageIdentity,
          cursorUpdatedAtMs: state.updatedAt.getTime(),
          complete: state.completedAt !== null,
        }
      })
    },

    async recordPageRequest(id, phase) {
      const updated = await db
        .update(collectionRuns)
        .set({
          requestPages: sql`${collectionRuns.requestPages} + 1`,
          ...(phase === 'probe' ? { discoveryPages: sql`${collectionRuns.discoveryPages} + 1` } : {}),
        })
        .where(eq(collectionRuns.id, id))
        .returning({ id: collectionRuns.id })
      if (updated.length !== 1) throw new Error('collection run does not exist')
    },

    async finishRun(id, status, stopReason, finishedAt) {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(collectionRuns)
          .set({ status, stopReason, finishedAt })
          .where(and(eq(collectionRuns.id, id), eq(collectionRuns.status, 'running')))
          .returning({
            feedKind: collectionRuns.feedKind,
            menuId: collectionRuns.menuId,
            targetStartMs: collectionRuns.targetStartMs,
            targetEndMs: collectionRuns.targetEndMs,
          })
        if (updated.length !== 1) throw new Error('collection run is not running')
        // Only `succeeded` means the walk reached the period's start; `partial`
        // spent its page budget and `interrupted` was stopped, and both leave
        // the job with work in it.
        const run = updated[0]
        if (status !== 'succeeded' || run === undefined) return
        await tx
          .update(feedState)
          .set({ completedAt: finishedAt })
          .where(
            and(
              eq(feedState.feedKind, run.feedKind),
              eq(feedState.menuId, run.menuId),
              // A run that finished against a period the feed has since moved
              // off says nothing about the period it holds now.
              eq(feedState.targetStartMs, run.targetStartMs),
              eq(feedState.targetEndMs, run.targetEndMs),
            ),
          )
      })
    },

    async reconcileOrphanedRuns(finishedAt) {
      const repaired = await db
        .update(collectionRuns)
        .set({ status: 'interrupted', stopReason: 'ORPHANED_RUNNING_RUN', finishedAt })
        .where(eq(collectionRuns.status, 'running'))
        .returning({ id: collectionRuns.id })
      return repaired.length
    },

    async persistPage(input) {
      const items = assertPersistablePage(input)
      const anchorPost = items.at(-1)
      if (anchorPost === undefined) throw new Error('persistable page unexpectedly has no posts')

      try {
        return await db.transaction(async (tx) => {
          const existingRows = await tx
            .select({ postId: posts.postId })
            .from(posts)
            .where(inArray(posts.postId, items.map((item) => item.postId)))
          const existingPostIds = new Set(existingRows.map((row) => row.postId))
          const insertedPostCount = items.filter((item) => !existingPostIds.has(item.postId)).length
          const updatedPostCount = items.length - insertedPostCount

          await tx
            .insert(boards)
            .values(boardRows(items, input.observedAt))
            .onConflictDoUpdate({
              target: boards.boardId,
              set: { name: sql`excluded.name`, lastSeenAt: input.observedAt },
            })

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
                snapshotAt: input.observedAt,
                firstSeenAt: input.observedAt,
                lastRunId: input.runId,
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
                commentCount: sql`excluded.comment_count`,
                snapshotAt: input.observedAt,
                lastRunId: input.runId,
              },
            })

          const updatedRun = await tx
            .update(collectionRuns)
            .set({
              collectionPages: sql`${collectionRuns.collectionPages} + 1`,
              observedPostCount: sql`${collectionRuns.observedPostCount} + ${items.length}`,
              insertedPostCount: sql`${collectionRuns.insertedPostCount} + ${insertedPostCount}`,
              updatedPostCount: sql`${collectionRuns.updatedPostCount} + ${updatedPostCount}`,
              lastCommittedPostId: anchorPost.postId,
              lastCommittedPage: input.referencePage,
            })
            .where(eq(collectionRuns.id, input.runId))
            .returning({ id: collectionRuns.id })
          if (updatedRun.length !== 1) throw new Error('collection run does not exist')

          const stateUpdated = await tx
            .update(feedState)
            .set({
              stateVersion: input.expectedState.stateVersion + 1,
              anchorPostId: anchorPost.postId,
              anchorPostedAt: new Date(anchorPost.postedAt),
              pageIdentity: input.page.pageIdentity,
              referencePage: input.referencePage,
              lastRunId: input.runId,
              updatedAt: input.observedAt,
            })
            .where(
              and(
                eq(feedState.feedKind, input.feed.feedKind),
                eq(feedState.menuId, input.feed.menuId),
                eq(feedState.stateVersion, input.expectedState.stateVersion),
                sql`${feedState.anchorPostId} is not distinct from ${input.expectedState.anchorPostId}`,
              ),
            )
            .returning({ stateVersion: feedState.stateVersion })
          if (stateUpdated.length !== 1) throw new FeedStateConflictError()

          return {
            kind: 'stored' as const,
            insertedPostCount,
            updatedPostCount,
            nextStateVersion: stateUpdated[0]?.stateVersion ?? input.expectedState.stateVersion + 1,
            anchorPostId: anchorPost.postId,
          }
        })
      } catch (error) {
        if (error instanceof FeedStateConflictError) return { kind: 'conflict' }
        throw error
      }
    },
  }
}
