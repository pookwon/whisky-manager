import { and, asc, eq, min, sql } from 'drizzle-orm'
import type { BoardSearchQuery } from '../../shared/boardSearchDictionary.js'
import type { CollectedArticlePage } from '../../shared/cafeArticleList.js'
import { kstDayKey, kstDayKeyRange } from '../../shared/kst.js'
import type { CollectionDatabase } from './client.js'
import { writePostRows } from './postPageWrite.js'
import type { CollectionRepository } from './repository.js'
import { boards, collectionRuns, posts } from './schema.js'
import { boardSearchState } from './boardSearchSchema.js'

export interface BoardSearchQueryState {
  readonly boardId: string
  readonly query: string
  readonly fromDay: string
  readonly toDay: string
  /** KST `yyyymmdd`: the end of the narrower window the query walks now; null is `toDay`. */
  readonly segmentToDay: string | null
  readonly queueOrder: number
  readonly expectedGain: number
  readonly lastCommittedPage: number | null
  readonly insertedCount: number
  readonly totalCount: number | null
  readonly complete: boolean
  readonly lastRunId: string | null
}

export interface ReplaceBoardSearchJobInput {
  readonly boardId: string
  readonly fromDay: string
  readonly toDay: string
  readonly queries: readonly BoardSearchQuery[]
  readonly at: Date
}

export interface BoardSearchRunInput {
  readonly id: string
  readonly boardId: string
  readonly query: string
  readonly fromDay: string
  readonly toDay: string
  readonly startedAt: Date
}

export interface PersistBoardSearchPageInput {
  readonly runId: string
  readonly boardId: string
  readonly query: string
  readonly fromDay: string
  readonly toDay: string
  readonly page: number
  readonly observedAt: Date
  readonly result: CollectedArticlePage
}

export interface NarrowBoardSearchSegmentInput {
  readonly boardId: string
  readonly query: string
  readonly fromDay: string
  readonly toDay: string
  readonly segmentToDay: string
  readonly at: Date
}

export interface CollectableBoard { readonly boardId: string; readonly name: string }

export interface BoardSearchRepository {
  listQueries(): Promise<readonly BoardSearchQueryState[]>
  listCollectableBoards(): Promise<readonly CollectableBoard[]>
  readBoardTitles(boardId: string): Promise<readonly string[]>
  oldestPostedAtMs(boardId: string): Promise<number | null>
  replaceJob(input: ReplaceBoardSearchJobInput): Promise<void>
  startRun(input: BoardSearchRunInput): Promise<void>
  recordPageRequest(runId: string): Promise<void>
  /** Walks the query on in a window ending at `segmentToDay`, from its first page. */
  narrowSegment(input: NarrowBoardSearchSegmentInput): Promise<void>
  persistPage(input: PersistBoardSearchPageInput): Promise<{ readonly insertedPostCount: number; readonly updatedPostCount: number }>
  finishRun(runId: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  /**
   * Marks search runs left `running` as interrupted, as the startup sweep does
   * for every feed. Only for a caller holding the collection lock: then no
   * search run is being written, and a running one is one nothing will close.
   */
  reconcileOrphanedRuns(finishedAt: Date): Promise<number>
}

type StateRow = typeof boardSearchState.$inferSelect

function toQueryState(row: StateRow): BoardSearchQueryState {
  return {
    boardId: row.boardId,
    query: row.query,
    fromDay: row.fromDay,
    toDay: row.toDay,
    segmentToDay: row.segmentToDay,
    queueOrder: row.queueOrder,
    expectedGain: row.expectedGain,
    lastCommittedPage: row.lastCommittedPage,
    insertedCount: row.insertedCount,
    totalCount: row.totalCount,
    complete: row.completedAt !== null,
    lastRunId: row.lastRunId,
  }
}

/**
 * The window is part of the match: a block that read the queue before a job
 * was replaced must not write its old window's cursor onto a same-named query
 * of the new one.
 */
function sameQueryWindow(boardId: string, query: string, fromDay: string, toDay: string) {
  return and(
    eq(boardSearchState.boardId, boardId),
    eq(boardSearchState.query, query),
    eq(boardSearchState.fromDay, fromDay),
    eq(boardSearchState.toDay, toDay),
  )
}

export function createBoardSearchRepository(db: CollectionDatabase, collection: CollectionRepository): BoardSearchRepository {
  return {
    async listQueries() {
      const rows = await db.select().from(boardSearchState).orderBy(asc(boardSearchState.queueOrder))
      return rows.map(toQueryState)
    },

    async listCollectableBoards() {
      return await db
        .select({ boardId: boards.boardId, name: boards.name })
        .from(boards)
        .where(eq(boards.collectEnabled, true))
        .orderBy(asc(boards.name))
    },

    async readBoardTitles(boardId) {
      const rows = await db.select({ title: posts.title }).from(posts).where(eq(posts.boardId, boardId))
      return rows.flatMap((row) => (row.title === null ? [] : [row.title]))
    },

    async oldestPostedAtMs(boardId) {
      const rows = await db.select({ oldest: min(posts.postedAt) }).from(posts).where(eq(posts.boardId, boardId))
      return rows[0]?.oldest?.getTime() ?? null
    },

    async replaceJob(input) {
      await db.transaction(async (tx) => {
        const running = await tx
          .select({ id: collectionRuns.id })
          .from(collectionRuns)
          .where(and(eq(collectionRuns.feedKind, 'board_search'), eq(collectionRuns.status, 'running')))
          .limit(1)
        if (running.length > 0) throw new Error('cannot replace the search job while a run is writing its cursor')
        await tx.delete(boardSearchState)
        if (input.queries.length === 0) return
        await tx.insert(boardSearchState).values(
          input.queries.map((entry, index) => ({
            boardId: input.boardId,
            query: entry.query,
            fromDay: input.fromDay,
            toDay: input.toDay,
            queueOrder: index + 1,
            expectedGain: entry.expectedGain,
            updatedAt: input.at,
          })),
        )
      })
    },

    async startRun(input) {
      await db.insert(collectionRuns).values({
        id: input.id,
        feedKind: 'board_search',
        menuId: input.boardId,
        searchQuery: input.query,
        runKind: 'backfill',
        targetStartMs: kstDayKeyRange(input.fromDay).startMs,
        targetEndMs: kstDayKeyRange(input.toDay).endMs,
        status: 'running',
        startedAt: input.startedAt,
      })
    },

    recordPageRequest(runId) {
      return collection.recordPageRequest(runId, 'collection')
    },

    async narrowSegment(input) {
      const state = await db
        .update(boardSearchState)
        .set({ segmentToDay: input.segmentToDay, lastCommittedPage: null, updatedAt: input.at })
        .where(sameQueryWindow(input.boardId, input.query, input.fromDay, input.toDay))
        .returning({ query: boardSearchState.query })
      if (state.length !== 1) throw new Error('board search query does not exist')
    },

    async persistPage(input) {
      const items = input.result.items
      const anchor = items.at(-1)
      if (anchor === undefined) throw new Error('an empty search page ends the query; it is not persisted')
      return await db.transaction(async (tx) => {
        const written = await writePostRows(tx, items, input.observedAt, input.runId)
        const run = await tx
          .update(collectionRuns)
          .set({
            collectionPages: sql`${collectionRuns.collectionPages} + 1`,
            observedPostCount: sql`${collectionRuns.observedPostCount} + ${items.length}`,
            insertedPostCount: sql`${collectionRuns.insertedPostCount} + ${written.insertedPostCount}`,
            updatedPostCount: sql`${collectionRuns.updatedPostCount} + ${written.updatedPostCount}`,
            lastCommittedPostId: anchor.postId,
            lastCommittedPage: input.page,
          })
          .where(eq(collectionRuns.id, input.runId))
          .returning({ id: collectionRuns.id })
        if (run.length !== 1) throw new Error('board search run does not exist')
        const state = await tx
          .update(boardSearchState)
          .set({
            lastCommittedPage: input.page,
            insertedCount: sql`${boardSearchState.insertedCount} + ${written.insertedPostCount}`,
            totalCount: sql`coalesce(${boardSearchState.totalCount}, ${input.result.pageInfo.totalArticleCount})`,
            lastRunId: input.runId,
            updatedAt: input.observedAt,
          })
          .where(sameQueryWindow(input.boardId, input.query, input.fromDay, input.toDay))
          .returning({ query: boardSearchState.query })
        if (state.length !== 1) throw new Error('board search query does not exist')
        return written
      })
    },

    async finishRun(runId, status, stopReason, finishedAt) {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(collectionRuns)
          .set({ status, stopReason, finishedAt })
          .where(and(eq(collectionRuns.id, runId), eq(collectionRuns.status, 'running')))
          .returning({
            boardId: collectionRuns.menuId,
            query: collectionRuns.searchQuery,
            targetStartMs: collectionRuns.targetStartMs,
            targetEndMs: collectionRuns.targetEndMs,
          })
        const run = updated[0]
        if (run === undefined) throw new Error('board search run is not running')
        // Only reaching the empty page past the end finishes a query.
        if (status !== 'succeeded' || run.query === null) return
        // The run's target range is the window it was started on, end exclusive.
        const window = sameQueryWindow(run.boardId, run.query, kstDayKey(run.targetStartMs), kstDayKey(run.targetEndMs - 1))
        await tx.update(boardSearchState).set({ completedAt: finishedAt, updatedAt: finishedAt }).where(window)
      })
    },

    async reconcileOrphanedRuns(finishedAt) {
      const repaired = await db
        .update(collectionRuns)
        .set({ status: 'interrupted', stopReason: 'ORPHANED_RUNNING_RUN', finishedAt })
        .where(and(eq(collectionRuns.feedKind, 'board_search'), eq(collectionRuns.status, 'running')))
        .returning({ id: collectionRuns.id })
      return repaired.length
    },
  }
}
