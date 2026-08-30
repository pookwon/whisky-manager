import { and, eq, inArray, sql } from 'drizzle-orm'
import { KST_OFFSET_MS } from '../../shared/kst.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../shared/cafeArticleList.js'
import type { CollectionDatabase } from './client.js'
import {
  cafeBoards,
  cafePosts,
  collectionFeedState,
  collectionRuns,
  postMetricObservations,
} from './schema.js'

export interface CollectionFeed {
  readonly cafeId: string
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
  readonly parserVersion: string
}

export type PersistCollectedPageResult =
  | {
      readonly kind: 'stored'
      readonly insertedPostCount: number
      readonly updatedPostCount: number
      readonly duplicateObservationCount: number
      readonly nextStateVersion: number
      readonly anchorPostId: string
    }
  | { readonly kind: 'conflict' }

export interface CollectionRepository {
  readFeedState(feed: CollectionFeed): Promise<CollectionFeedState | null>
  startRun(input: CreateCollectionRunInput): Promise<CollectionFeedState>
  recordPageRequest(id: string, phase: 'probe' | 'collection'): Promise<void>
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
  readonly anchorPostedDateKst: string | null
}

/** Thrown inside the transaction so every page write rolls back on CAS failure. */
class FeedStateConflictError extends Error {
  constructor() {
    super('collection feed state changed before this page could commit')
    this.name = 'FeedStateConflictError'
  }
}

export function postedDateKstFromEpochMs(epochMs: number): string {
  // Shifting the instant, then taking ISO's UTC date, is explicitly KST-based
  // and does not inherit the computer's locale or timezone.
  return new Date(epochMs + KST_OFFSET_MS).toISOString().slice(0, 10)
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
  if (input.parserVersion.trim() === '') throw new Error('parserVersion is required')

  const postIds = new Set<string>()
  for (const item of input.page.items) {
    if (item.cafeId !== input.feed.cafeId) throw new Error('page cafeId does not match feed cafeId')
    if (item.isNotice) throw new Error('notice rows are not valid collection page input')
    if (postIds.has(item.postId)) throw new Error(`page has duplicate postId ${item.postId}`)
    postIds.add(item.postId)
  }
  return input.page.items
}

function boardRows(items: readonly CollectedPostMetadata[], observedAt: Date) {
  const rows = new Map<string, { cafeId: string; boardId: string; name: string; discoveredAt: Date; lastSeenAt: Date }>()
  for (const item of items) {
    rows.set(`${item.cafeId}\u0000${item.boardId}`, {
      cafeId: item.cafeId,
      boardId: item.boardId,
      name: item.boardName,
      discoveredAt: observedAt,
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
          stateVersion: collectionFeedState.stateVersion,
          targetStartMs: collectionFeedState.targetStartMs,
          targetEndMs: collectionFeedState.targetEndMs,
          anchorPostId: collectionFeedState.anchorPostId,
          anchorPostedDateKst: collectionFeedState.anchorPostedDateKst,
          referencePage: collectionFeedState.referencePage,
          pageIdentity: collectionFeedState.pageIdentity,
        })
        .from(collectionFeedState)
        .where(and(eq(collectionFeedState.cafeId, feed.cafeId), eq(collectionFeedState.feedKind, feed.feedKind), eq(collectionFeedState.menuId, feed.menuId)))
        .limit(1)
      return state[0] ?? null
    },

    async startRun(input) {
      if (!Number.isSafeInteger(input.targetStartMs) || !Number.isSafeInteger(input.targetEndMs) || input.targetStartMs >= input.targetEndMs) {
        throw new Error('collection run target range must contain a positive interval')
      }
      return await db.transaction(async (tx) => {
        const inserted = await tx.insert(collectionFeedState).values({
          cafeId: input.cafeId, feedKind: input.feedKind, menuId: input.menuId,
          targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs,
          pageSize: 50, stateVersion: 0, updatedAt: input.startedAt,
        }).onConflictDoNothing().returning({ cafeId: collectionFeedState.cafeId })
        const rows = await tx.select().from(collectionFeedState).where(and(eq(collectionFeedState.cafeId, input.cafeId), eq(collectionFeedState.feedKind, input.feedKind), eq(collectionFeedState.menuId, input.menuId))).for('update')
        const current = rows[0]
        if (current === undefined) throw new Error('collection feed state does not exist')
        const running = await tx.select({ id: collectionRuns.id }).from(collectionRuns).where(and(eq(collectionRuns.cafeId, input.cafeId), eq(collectionRuns.feedKind, input.feedKind), eq(collectionRuns.menuId, input.menuId), eq(collectionRuns.status, 'running'))).limit(1)
        if (running.length > 0) throw new Error('collection feed already has a running run')
        const rangeChanged = current.targetStartMs !== input.targetStartMs || current.targetEndMs !== input.targetEndMs
        if (input.resumeFromCheckpoint && rangeChanged) throw new Error('cannot resume a checkpoint for a different target range')
        const reset = !input.resumeFromCheckpoint && inserted.length === 0
        const state = reset
          ? (await tx.update(collectionFeedState).set({ targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs, stateVersion: current.stateVersion + 1, anchorPostId: null, anchorPostedDateKst: null, firstPostId: null, lastPostId: null, pageIdentity: null, referencePage: null, lastRunId: null, updatedAt: input.startedAt }).where(and(eq(collectionFeedState.cafeId, input.cafeId), eq(collectionFeedState.feedKind, input.feedKind), eq(collectionFeedState.menuId, input.menuId))).returning())[0]
          : current
        if (state === undefined) throw new Error('collection feed reset failed')
        await tx.insert(collectionRuns).values({ ...input, status: 'running' })
        return { stateVersion: state.stateVersion, targetStartMs: state.targetStartMs, targetEndMs: state.targetEndMs, anchorPostId: state.anchorPostId, anchorPostedDateKst: state.anchorPostedDateKst, referencePage: state.referencePage, pageIdentity: state.pageIdentity }
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
      const updated = await db
        .update(collectionRuns)
        .set({ status, stopReason, finishedAt })
        .where(and(eq(collectionRuns.id, id), eq(collectionRuns.status, 'running')))
        .returning({ id: collectionRuns.id })
      if (updated.length !== 1) throw new Error('collection run is not running')
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
      const firstPost = items[0]
      const anchorPost = items.at(-1)
      if (firstPost === undefined || anchorPost === undefined) throw new Error('persistable page unexpectedly has no posts')

      try {
        return await db.transaction(async (tx) => {
          const existingRows = await tx
            .select({ postId: cafePosts.postId })
            .from(cafePosts)
            .where(and(eq(cafePosts.cafeId, input.feed.cafeId), inArray(cafePosts.postId, items.map((item) => item.postId))))
          const existingPostIds = new Set(existingRows.map((row) => row.postId))
          const insertedPostCount = items.filter((item) => !existingPostIds.has(item.postId)).length
          const updatedPostCount = items.length - insertedPostCount

          await tx
            .insert(cafeBoards)
            .values(boardRows(items, input.observedAt))
            .onConflictDoUpdate({
              target: [cafeBoards.cafeId, cafeBoards.boardId],
              set: {
                name: sql`excluded.name`,
                lastSeenAt: input.observedAt,
                retiredAt: null,
              },
            })

          await tx
            .insert(cafePosts)
            .values(
              items.map((item) => ({
                cafeId: item.cafeId,
                postId: item.postId,
                boardId: item.boardId,
                title: item.title,
                prefix: item.prefix,
                authorNickname: item.authorNickname,
                authorId: item.authorId,
                postedDateKst: postedDateKstFromEpochMs(item.postedAt),
                postedAt: new Date(item.postedAt),
                postedPrecision: 'millisecond' as const,
                firstSeenAt: input.observedAt,
                lastSeenAt: input.observedAt,
                lastObservedRunId: input.runId,
                unavailableAt: null,
              })),
            )
            .onConflictDoUpdate({
              target: [cafePosts.cafeId, cafePosts.postId],
              set: {
                boardId: sql`excluded.board_id`,
                title: sql`excluded.title`,
                prefix: sql`excluded.prefix`,
                authorNickname: sql`excluded.author_nickname`,
                authorId: sql`excluded.author_id`,
                postedDateKst: sql`excluded.posted_date_kst`,
                postedAt: sql`excluded.posted_at`,
                postedPrecision: sql`excluded.posted_precision`,
                lastSeenAt: input.observedAt,
                lastObservedRunId: input.runId,
                unavailableAt: null,
              },
            })

          const insertedObservations = await tx
            .insert(postMetricObservations)
            .values(
              items.map((item) => ({
                cafeId: item.cafeId,
                postId: item.postId,
                observedAt: input.observedAt,
                viewCount: item.viewCount,
                likeCount: null,
                commentCount: item.commentCount,
                collectionRunId: input.runId,
                source: 'list' as const,
                parserVersion: input.parserVersion,
              })),
            )
            .onConflictDoNothing()
            .returning({ postId: postMetricObservations.postId })

          const updatedRun = await tx
            .update(collectionRuns)
            .set({
              collectionPages: sql`${collectionRuns.collectionPages} + 1`,
              observedPostCount: sql`${collectionRuns.observedPostCount} + ${items.length}`,
              inRangePostCount: sql`${collectionRuns.inRangePostCount} + ${items.length}`,
              insertedPostCount: sql`${collectionRuns.insertedPostCount} + ${insertedPostCount}`,
              updatedPostCount: sql`${collectionRuns.updatedPostCount} + ${updatedPostCount}`,
              duplicatePostCount: sql`${collectionRuns.duplicatePostCount} + ${items.length - insertedObservations.length}`,
              lastCommittedAnchorPostId: anchorPost.postId,
              lastCommittedPage: input.referencePage,
            })
            .where(eq(collectionRuns.id, input.runId))
            .returning({ id: collectionRuns.id })
          if (updatedRun.length !== 1) throw new Error('collection run does not exist')

          const stateUpdated = await tx
            .update(collectionFeedState)
            .set({
              stateVersion: input.expectedState.stateVersion + 1,
              anchorPostId: anchorPost.postId,
              anchorPostedDateKst: postedDateKstFromEpochMs(anchorPost.postedAt),
              firstPostId: firstPost.postId,
              lastPostId: anchorPost.postId,
              pageIdentity: input.page.pageIdentity,
              referencePage: input.referencePage,
              lastRunId: input.runId,
              updatedAt: input.observedAt,
            })
            .where(
              and(
                eq(collectionFeedState.cafeId, input.feed.cafeId),
                eq(collectionFeedState.feedKind, input.feed.feedKind),
                eq(collectionFeedState.menuId, input.feed.menuId),
                eq(collectionFeedState.stateVersion, input.expectedState.stateVersion),
                sql`${collectionFeedState.anchorPostId} is not distinct from ${input.expectedState.anchorPostId}`,
              ),
            )
            .returning({ stateVersion: collectionFeedState.stateVersion })
          if (stateUpdated.length !== 1) throw new FeedStateConflictError()

          return {
            kind: 'stored' as const,
            insertedPostCount,
            updatedPostCount,
            duplicateObservationCount: items.length - insertedObservations.length,
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
