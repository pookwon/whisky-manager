import { and, desc, eq } from 'drizzle-orm'
import { kstDayKeyRange } from '../../shared/kst.js'
import type { CollectionDatabase } from './client.js'
import { collectionRuns } from './schema.js'

type RunStatus = (typeof collectionRuns.$inferSelect)['status']

export interface BoardSearchLastRun {
  readonly status: RunStatus
  readonly stopReason: string | null
}

export interface BoardSearchJobWindow {
  readonly boardId: string
  readonly fromDay: string
  readonly toDay: string
}

/**
 * How each query's newest run of the job ended. Search runs stay off the
 * article collection's recent log, so this is where the screen learns why a
 * query failed.
 */
export interface BoardSearchLastRunQuery {
  read(job: BoardSearchJobWindow): Promise<ReadonlyMap<string, BoardSearchLastRun>>
}

export function createBoardSearchLastRunQuery(db: CollectionDatabase): BoardSearchLastRunQuery {
  return {
    async read(job) {
      // The window is the run's target range, as startRun wrote it.
      const rows = await db
        .selectDistinctOn([collectionRuns.searchQuery], {
          query: collectionRuns.searchQuery,
          status: collectionRuns.status,
          stopReason: collectionRuns.stopReason,
        })
        .from(collectionRuns)
        .where(
          and(
            eq(collectionRuns.feedKind, 'board_search'),
            eq(collectionRuns.menuId, job.boardId),
            eq(collectionRuns.targetStartMs, kstDayKeyRange(job.fromDay).startMs),
            eq(collectionRuns.targetEndMs, kstDayKeyRange(job.toDay).endMs),
          ),
        )
        .orderBy(collectionRuns.searchQuery, desc(collectionRuns.startedAt))
      return new Map(rows.flatMap((row) => (row.query === null ? [] : [[row.query, { status: row.status, stopReason: row.stopReason }] as const])))
    },
  }
}
