import { and, desc, eq, sql } from 'drizzle-orm'
import type { CollectionDatabase } from './client.js'
import type { CollectionFeed } from './repository.js'
import { cafeBoards, cafePosts, collectionRuns, postMetricObservations } from './schema.js'

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
  readonly observations: number
  readonly boards: number
  readonly oldestPostedAtMs: number | null
  readonly newestPostedAtMs: number | null
}

export interface CollectionStatus {
  readonly totals: CollectionTotals
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

/**
 * An aggregate is not a column, so the driver hands it back unconverted. Asking
 * postgres for the epoch keeps the conversion out of string parsing entirely.
 */
function epochFromSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null
}

/** Postgres counts arrive as strings; a count this small always fits a number. */
function count(value: string | number | null): number {
  return Number(value ?? 0)
}

export function createCollectionStatusQuery(db: CollectionDatabase): CollectionStatusQuery {
  return {
    async read(feed) {
      const feedRuns = and(
        eq(collectionRuns.cafeId, feed.cafeId),
        eq(collectionRuns.feedKind, feed.feedKind),
        eq(collectionRuns.menuId, feed.menuId),
      )

      const [posts, observations, boards, runs] = await Promise.all([
        db
          .select({
            posts: sql<string>`count(*)`,
            oldest: sql<string | null>`extract(epoch from min(${cafePosts.postedAt}))`,
            newest: sql<string | null>`extract(epoch from max(${cafePosts.postedAt}))`,
          })
          .from(cafePosts)
          .where(eq(cafePosts.cafeId, feed.cafeId)),
        db
          .select({ observations: sql<string>`count(*)` })
          .from(postMetricObservations)
          .where(eq(postMetricObservations.cafeId, feed.cafeId)),
        db
          .select({ boards: sql<string>`count(*)` })
          .from(cafeBoards)
          .where(and(eq(cafeBoards.cafeId, feed.cafeId), sql`${cafeBoards.retiredAt} is null`)),
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
            cursorPostedAt: cafePosts.postedAt,
          })
          .from(collectionRuns)
          // The anchor is a post id, so its time has to be looked up. A left
          // join keeps a run whose anchor post was since deleted.
          .leftJoin(
            cafePosts,
            and(
              eq(cafePosts.cafeId, collectionRuns.cafeId),
              eq(cafePosts.postId, collectionRuns.lastCommittedAnchorPostId),
            ),
          )
          .where(feedRuns)
          .orderBy(desc(collectionRuns.startedAt))
          .limit(RECENT_RUN_LIMIT),
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

      const totalsRow = posts[0]
      return {
        totals: {
          posts: count(totalsRow?.posts ?? 0),
          observations: count(observations[0]?.observations ?? 0),
          boards: count(boards[0]?.boards ?? 0),
          oldestPostedAtMs: epochFromSeconds(totalsRow?.oldest),
          newestPostedAtMs: epochFromSeconds(totalsRow?.newest),
        },
        // Only one run per feed can be running, which the schema enforces.
        running: recentRuns.find((run) => run.status === 'running') ?? null,
        recentRuns,
      }
    },
  }
}
