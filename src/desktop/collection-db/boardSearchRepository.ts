import { and, asc, eq, min, sql } from 'drizzle-orm'
import type { BoardSearchQuery } from '../../shared/boardSearchDictionary.js'
import type { CollectedArticlePage } from '../../shared/cafeArticleList.js'
import { kstDayKey, kstDayKeyRange } from '../../shared/kst.js'
import { BELOW_PROBE_YIELD } from '../boardSearchYield.js'
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
  /** Whether the query ended because its pages stopped bringing in a new post each: the probe reads those ids cheaper. */
  readonly belowProbeYield: boolean
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

export interface BoardSearchRepository {
  listQueries(): Promise<readonly BoardSearchQueryState[]>
  /** The board's name; null for a board the cafe has never listed. */
  readBoardName(boardId: string): Promise<string | null>
  readBoardTitles(boardId: string): Promise<readonly string[]>
  oldestPostedAtMs(boardId: string): Promise<number | null>
  replaceJob(input: ReplaceBoardSearchJobInput): Promise<void>
  /** Appends the queries the job does not hold, in the given order, after its last `queue_order`, in the job's own board and window; returns how many it added. Throws when no job exists or a `board_search` run is `running`. */
  extendJob(input: { readonly queries: readonly BoardSearchQuery[]; readonly at: Date }): Promise<number>
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

function toQueryState(row: StateRow, lastStopReason: string | null): BoardSearchQueryState {
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
    belowProbeYield: row.completedAt !== null && lastStopReason === BELOW_PROBE_YIELD,
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
      // The last run is the one that stored the query's last page, or the one that ended it.
      const rows = await db
        .select({ state: boardSearchState, lastStopReason: collectionRuns.stopReason })
        .from(boardSearchState)
        .leftJoin(collectionRuns, eq(collectionRuns.id, boardSearchState.lastRunId))
        .orderBy(asc(boardSearchState.queueOrder))
      return rows.map((row) => toQueryState(row.state, row.lastStopReason))
    },

    async readBoardName(boardId) {
      const rows = await db.select({ name: boards.name }).from(boards).where(eq(boards.boardId, boardId))
      return rows[0]?.name ?? null
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

    async extendJob(input) {
      return await db.transaction(async (tx) => {
        const running = await tx
          .select({ id: collectionRuns.id })
          .from(collectionRuns)
          .where(and(eq(collectionRuns.feedKind, 'board_search'), eq(collectionRuns.status, 'running')))
          .limit(1)
        if (running.length > 0) throw new Error('cannot extend the search job while a run is writing its cursor')
        const rows = await tx.select().from(boardSearchState).orderBy(asc(boardSearchState.queueOrder))
        const last = rows.at(-1)
        if (last === undefined) throw new Error('there is no search job to extend')
        const held = new Set(rows.map((row) => row.query))
        const added = input.queries.filter((entry) => !held.has(entry.query))
        if (added.length === 0) return 0
        await tx.insert(boardSearchState).values(
          added.map((entry, index) => ({
            boardId: last.boardId,
            query: entry.query,
            fromDay: last.fromDay,
            toDay: last.toDay,
            queueOrder: last.queueOrder + index + 1,
            expectedGain: entry.expectedGain,
            updatedAt: input.at,
          })),
        )
        return added.length
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
        // Only a success finishes a query: the empty page past the end, or pages that stopped paying.
        if (status !== 'succeeded' || run.query === null) return
        // The run's target range is the window it was started on, end exclusive.
        const window = sameQueryWindow(run.boardId, run.query, kstDayKey(run.targetStartMs), kstDayKey(run.targetEndMs - 1))
        // The ending run is the last run even when it stored no page, so its stop reason is the query's.
        await tx.update(boardSearchState).set({ completedAt: finishedAt, lastRunId: runId, updatedAt: finishedAt }).where(window)
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
