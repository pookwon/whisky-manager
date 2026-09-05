import { and, desc, eq, sql } from 'drizzle-orm'
import type { CollectionDatabase } from './client.js'
import type { CollectionFeedKind, StoredFeedState } from './repository.js'
import { toStoredFeedState } from './repository.js'
import { describeJob } from '../collectionScope.js'
import { boards, collectionRuns, feedState, posts } from './schema.js'

/**
 * What the collection screen reads. Separate from the repository because that
 * one owns writing a page atomically; this one only answers questions, and the
 * two change for different reasons.
 */
export interface CollectionRunSummary {
  readonly id: string
  readonly runKind: 'development' | 'backfill' | 'incremental'
  readonly status: 'running' | 'succeeded' | 'partial' | 'failed' | 'interrupted'
  readonly stopReason: string | null
  readonly startedAtMs: number
  readonly finishedAtMs: number | null
  readonly targetStartMs: number
  readonly targetEndMs: number
  readonly collectionPages: number
  readonly requestPages: number
  readonly insertedPostCount: number
  readonly observedPostCount: number
  /**
   * When the last committed post was written, not when it was read. It is how
   * far back into the target range the run has walked, which is the only honest
   * progress figure: a page number means something different an hour later.
   */
  readonly cursorPostedAtMs: number | null
  /** The board this run was walking, or null for a whole-cafe run. */
  readonly boardName: string | null
}

export interface CollectionTotals {
  readonly posts: number
  readonly boards: number
  readonly oldestPostedAtMs: number | null
  readonly newestPostedAtMs: number | null
  /** When the most recent reading of any post was taken. */
  readonly lastSnapshotAtMs: number | null
}

export type BoardProgressState = 'waiting' | 'walking' | 'complete' | 'horizon' | 'failed'

export interface BoardProgress {
  readonly queueOrder: number
  readonly boardId: string
  readonly name: string
  readonly state: BoardProgressState
  readonly cursorPostedAtMs: number | null
  /** Posts this job inserted from this board, summed over its runs. */
  readonly insertedPostCount: number
}

/**
 * The period being worked through, and how far into it the walk has come.
 *
 * A job outlives the runs that advance it: blocks end when their page budget
 * runs out, and the next one picks the same job up. The screen has to name the
 * job rather than the last run, or an operator between blocks is told nothing
 * is happening when in fact a month of backfill is half done.
 */
export interface CollectionJob {
  readonly scope: CollectionFeedKind
  readonly targetStartMs: number
  readonly targetEndMs: number
  /** For a board job: the oldest cursor among boards still walking. */
  readonly cursorPostedAtMs: number | null
  readonly cursorUpdatedAtMs: number
  readonly complete: boolean
  /** Whether this job was told to keep going outside the operating hours. */
  readonly forced: boolean
  /** Empty for a whole-cafe job. */
  readonly boards: readonly BoardProgress[]
}

export interface CollectionStatus {
  readonly totals: CollectionTotals
  /** Null when no period has been asked for yet. */
  readonly job: CollectionJob | null
  /** The run in flight, which is also the first of `recentRuns`. */
  readonly running: CollectionRunSummary | null
  readonly recentRuns: readonly CollectionRunSummary[]
}

export interface CollectionStatusQuery {
  read(): Promise<CollectionStatus>
}

/**
 * A day's worth of blocks, not a screenful.
 *
 * The dashboard draws the blocks that ran today, and the shortest schedule the
 * settings allow — thirty minutes of work, thirty of rest — fits twelve of them
 * into a twelve-hour window. Eight would have cut the morning off the drawing
 * and made the day look like it started at noon. Screens that want fewer take
 * the head of the list.
 */
const RECENT_RUN_LIMIT = 24

function epochMs(value: Date | null): number | null {
  return value === null ? null : value.getTime()
}

/** Postgres counts arrive as strings; a count this small always fits a number. */
function count(value: string | number | null | undefined): number {
  return Number(value ?? 0)
}

/**
 * An aggregate is not a column, so the driver hands it back unconverted. Asking
 * postgres for the epoch keeps the conversion out of string parsing entirely.
 */
function epochFromSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null
}

function boardState(row: StoredFeedState, running: boolean, lastFailed: boolean): BoardProgressState {
  if (row.horizonReached) return 'horizon'
  if (row.complete) return 'complete'
  if (running) return 'walking'
  if (lastFailed) return 'failed'
  return row.anchorPostId === null ? 'waiting' : 'walking'
}

export function createCollectionStatusQuery(db: CollectionDatabase): CollectionStatusQuery {
  return {
    async read() {
      const [postTotals, boardTotals, feedStateRows, runs] = await Promise.all([
        db
          .select({
            posts: sql<string>`count(*)`,
            oldest: sql<string | null>`extract(epoch from min(${posts.postedAt}))`,
            newest: sql<string | null>`extract(epoch from max(${posts.postedAt}))`,
            lastSnapshot: sql<string | null>`extract(epoch from max(${posts.snapshotAt}))`,
          })
          .from(posts),
        db.select({ boards: sql<string>`count(*)` }).from(boards),
        db
          .select({ state: feedState, boardName: boards.name })
          .from(feedState)
          .leftJoin(boards, and(eq(feedState.feedKind, 'board'), eq(boards.boardId, feedState.menuId)))
          .orderBy(feedState.feedKind, feedState.queueOrder, feedState.menuId),
        db
          .select({
            id: collectionRuns.id,
            feedKind: collectionRuns.feedKind,
            menuId: collectionRuns.menuId,
            runKind: collectionRuns.runKind,
            status: collectionRuns.status,
            stopReason: collectionRuns.stopReason,
            startedAt: collectionRuns.startedAt,
            finishedAt: collectionRuns.finishedAt,
            targetStartMs: collectionRuns.targetStartMs,
            targetEndMs: collectionRuns.targetEndMs,
            collectionPages: collectionRuns.collectionPages,
            requestPages: collectionRuns.requestPages,
            insertedPostCount: collectionRuns.insertedPostCount,
            observedPostCount: collectionRuns.observedPostCount,
            cursorPostedAt: posts.postedAt,
            boardName: boards.name,
          })
          .from(collectionRuns)
          .leftJoin(posts, eq(posts.postId, collectionRuns.lastCommittedPostId))
          .leftJoin(boards, and(eq(collectionRuns.feedKind, 'board'), eq(boards.boardId, collectionRuns.menuId)))
          .orderBy(desc(collectionRuns.startedAt))
          .limit(RECENT_RUN_LIMIT),
      ])

      const storedFeedStates: StoredFeedState[] = feedStateRows.map(({ state, boardName }) =>
        toStoredFeedState(state, boardName),
      )

      const job = describeJob(storedFeedStates)

      const recentRuns: CollectionRunSummary[] = runs.map((run) => ({
        id: run.id,
        runKind: run.runKind,
        status: run.status,
        stopReason: run.stopReason,
        startedAtMs: run.startedAt.getTime(),
        finishedAtMs: epochMs(run.finishedAt),
        targetStartMs: run.targetStartMs,
        targetEndMs: run.targetEndMs,
        collectionPages: run.collectionPages,
        requestPages: run.requestPages,
        insertedPostCount: run.insertedPostCount,
        observedPostCount: run.observedPostCount,
        cursorPostedAtMs: epochMs(run.cursorPostedAt),
        boardName: run.boardName ?? null,
      }))

      let collectionJob: CollectionJob | null = null
      if (job !== null) {
        // Determine board-level inserted post counts when needed.
        let boardInsertedCounts = new Map<string, number>()
        if (job.scope === 'board') {
          const countRows = await db
            .select({
              menuId: collectionRuns.menuId,
              total: sql<string>`sum(${collectionRuns.insertedPostCount})`,
            })
            .from(collectionRuns)
            .where(
              and(
                eq(collectionRuns.feedKind, 'board'),
                eq(collectionRuns.targetStartMs, job.targetStartMs),
                eq(collectionRuns.targetEndMs, job.targetEndMs),
              ),
            )
            .groupBy(collectionRuns.menuId)
          for (const row of countRows) {
            boardInsertedCounts.set(row.menuId, Number(row.total ?? 0))
          }
        }

        // Fetch each board feed's latest run status directly so boards beyond the
        // recent-run window are not misread as walking when they last failed.
        const latestBoardRunResult = await db.execute<{ menu_id: string; status: string }>(
          sql`select distinct on (${collectionRuns.menuId})
                ${collectionRuns.menuId},
                ${collectionRuns.status}
              from ${collectionRuns}
              where ${collectionRuns.feedKind} = 'board'
                and ${collectionRuns.targetStartMs} = ${job.targetStartMs}
                and ${collectionRuns.targetEndMs} = ${job.targetEndMs}
              order by ${collectionRuns.menuId}, ${collectionRuns.startedAt} desc`,
        )

        const runningFeedKey = new Set<string>()
        const lastFailedFeedKey = new Set<string>()
        for (const row of latestBoardRunResult.rows) {
          const key = `board:${row.menu_id as string}`
          if (row.status === 'running') runningFeedKey.add(key)
          if (row.status === 'failed') lastFailedFeedKey.add(key)
        }
        // Also track any in-flight run from the recent list (covers non-board feeds).
        for (const run of runs) {
          if (run.status === 'running') runningFeedKey.add(`${run.feedKind}:${run.menuId}`)
        }

        const boardProgressList: BoardProgress[] = job.feeds
          .filter((feed) => feed.feed.feedKind === 'board')
          .map((feed) => {
            const key = `board:${feed.feed.menuId}`
            const running = runningFeedKey.has(key)
            const lastFailed = lastFailedFeedKey.has(key)
            return {
              queueOrder: feed.queueOrder ?? 0,
              boardId: feed.feed.menuId,
              name: feed.boardName ?? feed.feed.menuId,
              state: boardState(feed, running, lastFailed),
              cursorPostedAtMs: feed.anchorPostedAtMs,
              insertedPostCount: boardInsertedCounts.get(feed.feed.menuId) ?? 0,
            }
          })

        // cursorPostedAtMs: whole-cafe → that row's anchorPostedAtMs; board → min among remaining with anchor.
        let cursorPostedAtMs: number | null = null
        if (job.scope === 'all_articles') {
          cursorPostedAtMs = job.feeds[0]?.anchorPostedAtMs ?? null
        } else {
          const anchored = job.remaining.map((f) => f.anchorPostedAtMs).filter((ms): ms is number => ms !== null)
          cursorPostedAtMs = anchored.length > 0 ? Math.min(...anchored) : null
        }

        // cursorUpdatedAtMs: max over all job rows.
        const cursorUpdatedAtMs = Math.max(...job.feeds.map((f) => f.cursorUpdatedAtMs))

        collectionJob = {
          scope: job.scope,
          targetStartMs: job.targetStartMs,
          targetEndMs: job.targetEndMs,
          cursorPostedAtMs,
          cursorUpdatedAtMs,
          complete: job.complete,
          forced: job.forced,
          boards: boardProgressList,
        }
      }

      const totalsRow = postTotals[0]
      return {
        totals: {
          posts: count(totalsRow?.posts),
          boards: count(boardTotals[0]?.boards),
          oldestPostedAtMs: epochFromSeconds(totalsRow?.oldest),
          newestPostedAtMs: epochFromSeconds(totalsRow?.newest),
          lastSnapshotAtMs: epochFromSeconds(totalsRow?.lastSnapshot),
        },
        job: collectionJob,
        // Only one run per feed can be running, which the schema enforces.
        running: recentRuns.find((run) => run.status === 'running') ?? null,
        recentRuns,
      }
    },
  }
}
