import { and, desc, eq, sql } from 'drizzle-orm'
import type { CollectionDatabase } from './client.js'
import type { CollectionFeed } from './repository.js'
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
}

export interface CollectionTotals {
  readonly posts: number
  readonly boards: number
  readonly oldestPostedAtMs: number | null
  readonly newestPostedAtMs: number | null
  /** When the most recent reading of any post was taken. */
  readonly lastSnapshotAtMs: number | null
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
  readonly targetStartMs: number
  readonly targetEndMs: number
  /** Posted time of the last committed post; null before the first page lands. */
  readonly cursorPostedAtMs: number | null
  readonly cursorUpdatedAtMs: number
  readonly complete: boolean
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
  read(feed: CollectionFeed): Promise<CollectionStatus>
}

const RECENT_RUN_LIMIT = 8

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

export function createCollectionStatusQuery(db: CollectionDatabase): CollectionStatusQuery {
  return {
    async read(feed) {
      const [postTotals, boardTotals, runs, jobRows] = await Promise.all([
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
          .select({
            id: collectionRuns.id,
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
          })
          .from(collectionRuns)
          // The cursor is a post id, so its time has to be looked up. A left
          // join keeps a run whose last post was since deleted.
          .leftJoin(posts, eq(posts.postId, collectionRuns.lastCommittedPostId))
          .where(and(eq(collectionRuns.feedKind, feed.feedKind), eq(collectionRuns.menuId, feed.menuId)))
          .orderBy(desc(collectionRuns.startedAt))
          .limit(RECENT_RUN_LIMIT),
        db
          .select({
            targetStartMs: feedState.targetStartMs,
            targetEndMs: feedState.targetEndMs,
            anchorPostedAt: feedState.anchorPostedAt,
            updatedAt: feedState.updatedAt,
          })
          .from(feedState)
          .where(and(eq(feedState.feedKind, feed.feedKind), eq(feedState.menuId, feed.menuId)))
          .limit(1),
      ])

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
      }))

      const jobRow = jobRows[0]
      const cursorPostedAtMs = epochMs(jobRow?.anchorPostedAt ?? null)
      const job: CollectionJob | null =
        jobRow === undefined
          ? null
          : {
              targetStartMs: jobRow.targetStartMs,
              targetEndMs: jobRow.targetEndMs,
              cursorPostedAtMs,
              cursorUpdatedAtMs: jobRow.updatedAt.getTime(),
              // Walked past the period's start, so there is nothing older left
              // to read. Kept as a derived answer rather than a stored flag: a
              // second place to write it is a second place to disagree.
              complete: cursorPostedAtMs !== null && cursorPostedAtMs <= jobRow.targetStartMs,
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
        job,
        // Only one run per feed can be running, which the schema enforces.
        running: recentRuns.find((run) => run.status === 'running') ?? null,
        recentRuns,
      }
    },
  }
}
