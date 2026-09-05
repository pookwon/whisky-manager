import { and, eq, inArray, sql } from 'drizzle-orm'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../shared/cafeArticleList.js'
import { CAFE_ARTICLE_LIST } from '../../shared/cafeArticleFixture.js'
import type { CollectionDatabase } from './client.js'
import { boards, collectionRuns, feedState, posts } from './schema.js'

export type CollectionFeedKind = 'all_articles' | 'board'

/**
 * Which feed of the cafe. The cafe itself is the database, so it is not part of
 * this: one collection database holds one cafe's feeds. `all_articles` is the
 * whole cafe under menu 0; `board` is one board's own list under its menu.
 */
export interface CollectionFeed {
  readonly feedKind: CollectionFeedKind
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
  /** Every feed row, board rows carrying their board's name. */
  listFeedStates(): Promise<readonly StoredFeedState[]>
  /**
   * Makes the job anew: rows of the other scope go, rows of this scope are
   * reset to the period, and a board job gets one row per collectable board
   * ordered by how many of its posts are already stored, most first.
   */
  replaceJob(input: ReplaceJobInput): Promise<readonly StoredFeedState[]>
  startRun(input: CreateCollectionRunInput): Promise<CollectionFeedState>
  recordPageRequest(id: string, phase: 'probe' | 'collection'): Promise<void>
  /**
   * Ends a run, and — when it ended by reaching the period's start — records
   * that on the feed in the same transaction. Two readers ask whether the job
   * is done (the scheduler and the screens), and a fact written in one place is
   * a fact they cannot disagree about.
   */
  finishRun(id: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  /** Records that the cafe would serve no more pages for this feed. */
  markHorizonReached(feed: CollectionFeed, at: Date): Promise<void>
  /** Turns the operating hours off, or back on, for the whole job as it stands. */
  setForced(forcedAt: Date | null): Promise<void>
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
  /** Whether this job was asked to keep going outside the operating hours. */
  readonly forced: boolean
  /** Whether the cafe stopped serving pages before the period was done. */
  readonly horizonReached: boolean
}

/** A feed's state together with what identifies it, for reading the job whole. */
export interface StoredFeedState extends CollectionFeedState {
  readonly feed: CollectionFeed
  readonly queueOrder: number | null
  readonly boardName: string | null
}

export interface ReplaceJobInput {
  readonly scope: CollectionFeedKind
  readonly targetStartMs: number
  readonly targetEndMs: number
  readonly at: Date
}

type FeedStateRow = typeof feedState.$inferSelect

function toFeedState(row: FeedStateRow): CollectionFeedState {
  return {
    stateVersion: row.stateVersion,
    targetStartMs: row.targetStartMs,
    targetEndMs: row.targetEndMs,
    anchorPostId: row.anchorPostId,
    anchorPostedAtMs: row.anchorPostedAt?.getTime() ?? null,
    referencePage: row.referencePage,
    pageIdentity: row.pageIdentity,
    cursorUpdatedAtMs: row.updatedAt.getTime(),
    complete: row.completedAt !== null,
    forced: row.forcedAt !== null,
    horizonReached: row.horizonReachedAt !== null,
  }
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
  const repository: CollectionRepository = {
    async readFeedState(feed) {
      const rows = await db
        .select()
        .from(feedState)
        .where(and(eq(feedState.feedKind, feed.feedKind), eq(feedState.menuId, feed.menuId)))
        .limit(1)
      const row = rows[0]
      if (row === undefined) return null
      return toFeedState(row)
    },

    async listFeedStates() {
      const rows = await db
        .select({ state: feedState, boardName: boards.name })
        .from(feedState)
        .leftJoin(boards, and(eq(feedState.feedKind, 'board'), eq(boards.boardId, feedState.menuId)))
        .orderBy(feedState.feedKind, feedState.queueOrder, feedState.menuId)
      return rows.map(({ state, boardName }) => ({
        ...toFeedState(state),
        feed: { feedKind: state.feedKind as CollectionFeedKind, menuId: state.menuId },
        queueOrder: state.queueOrder,
        boardName,
      }))
    },

    async replaceJob(input) {
      if (!Number.isSafeInteger(input.targetStartMs) || !Number.isSafeInteger(input.targetEndMs) || input.targetStartMs >= input.targetEndMs) {
        throw new Error('collection job target range must contain a positive interval')
      }
      await db.transaction(async (tx) => {
        const running = await tx.select({ id: collectionRuns.id }).from(collectionRuns).where(eq(collectionRuns.status, 'running')).limit(1)
        if (running.length > 0) throw new Error('cannot replace the job while a run is writing its cursor')
        // One job at a time: whatever the other scope held is gone, and its
        // runs stay in `runs` as history because nothing there points here.
        await tx.delete(feedState)
        if (input.scope === 'all_articles') {
          await tx.insert(feedState).values({
            feedKind: 'all_articles', menuId: CAFE_ARTICLE_LIST.menuId,
            targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs,
            stateVersion: 0, updatedAt: input.at,
          })
          return
        }
        // Most posts first. The count is what this database already holds,
        // which is the operator's own measure of where the bulk is.
        const ordered = await tx
          .select({ boardId: boards.boardId, stored: sql<string>`count(${posts.postId})` })
          .from(boards)
          .leftJoin(posts, eq(posts.boardId, boards.boardId))
          .where(eq(boards.collectEnabled, true))
          .groupBy(boards.boardId)
          .orderBy(sql`count(${posts.postId}) desc`, boards.boardId)
        if (ordered.length === 0) throw new Error('no collectable boards are known yet')
        await tx.insert(feedState).values(
          ordered.map((board, index) => ({
            feedKind: 'board' as const, menuId: board.boardId,
            targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs,
            stateVersion: 0, queueOrder: index + 1, updatedAt: input.at,
          })),
        )
      })
      return await repository.listFeedStates()
    },

    async markHorizonReached(feed, at) {
      await db
        .update(feedState)
        .set({ horizonReachedAt: at, forcedAt: null })
        .where(and(eq(feedState.feedKind, feed.feedKind), eq(feedState.menuId, feed.menuId)))
    },

    async setForced(forcedAt) {
      await db.update(feedState).set({ forcedAt })
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
          ? (await tx.update(feedState).set({ targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs, stateVersion: current.stateVersion + 1, anchorPostId: null, anchorPostedAt: null, pageIdentity: null, referencePage: null, lastRunId: null, completedAt: null, forcedAt: null, horizonReachedAt: null, updatedAt: input.startedAt }).where(and(eq(feedState.feedKind, input.feedKind), eq(feedState.menuId, input.menuId))).returning())[0]
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
        return toFeedState(state)
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
          // The force goes with it: the period it was turned on for is done,
          // and nothing should still be reading at three in the morning.
          .set({ completedAt: finishedAt, forcedAt: null })
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
  return repository
}
