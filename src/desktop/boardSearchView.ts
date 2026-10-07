import type { BoardSearchCoverage, BoardSearchCoverageQuery } from './collection-db/boardSearchCoverageQuery.js'
import type { BoardSearchLastRun, BoardSearchLastRunQuery } from './collection-db/boardSearchLastRunQuery.js'
import type { BoardSearchQueryState, BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import type { BoardSearchBlockFailure, BoardSearchProgress } from './boardSearchRunner.js'

/** A query of the job with how its newest run in the job's window ended; null before its first run. */
export interface BoardSearchQueryView extends BoardSearchQueryState {
  readonly lastRun: BoardSearchLastRun | null
}

/** The search job in hand, summed up for the screen. */
export interface BoardSearchJobView {
  readonly boardId: string
  readonly boardName: string | null
  readonly fromDay: string
  readonly toDay: string
  readonly queries: readonly BoardSearchQueryView[]
  readonly completedCount: number
  readonly insertedTotal: number
  /** The first unfinished query in order; null when all are done. */
  readonly current: string | null
  readonly coverage: BoardSearchCoverage
}

/** What the search backfill card shows: the job the pipeline walks, if there is one, and the block in flight. */
export interface BoardSearchView {
  readonly running: boolean
  /** The block in flight's progress; null when none runs. */
  readonly progress: BoardSearchProgress | null
  /** Why the last block ended with no run row saying it; null once a block starts again. */
  readonly blockFailure: BoardSearchBlockFailure | null
  readonly job: BoardSearchJobView | null
}

export async function readBoardSearchView(inputs: {
  readonly repository: BoardSearchRepository
  readonly coverage: BoardSearchCoverageQuery
  readonly lastRuns: BoardSearchLastRunQuery
  readonly running: boolean
  readonly progress: BoardSearchProgress | null
  readonly blockFailure: BoardSearchBlockFailure | null
}): Promise<BoardSearchView> {
  const queries = await inputs.repository.listQueries()
  const first = queries[0]
  if (first === undefined) return { running: inputs.running, progress: inputs.progress, blockFailure: inputs.blockFailure, job: null }
  const insertedTotal = queries.reduce((sum, query) => sum + query.insertedCount, 0)
  const [boardName, lastRuns] = await Promise.all([
    inputs.repository.readBoardName(first.boardId),
    inputs.lastRuns.read({ boardId: first.boardId, fromDay: first.fromDay, toDay: first.toDay }),
  ])
  return {
    running: inputs.running,
    progress: inputs.progress,
    blockFailure: inputs.blockFailure,
    job: {
      boardId: first.boardId,
      boardName,
      fromDay: first.fromDay,
      toDay: first.toDay,
      queries: queries.map((query) => ({ ...query, lastRun: lastRuns.get(query.query) ?? null })),
      completedCount: queries.filter((query) => query.complete).length,
      insertedTotal,
      current: queries.find((query) => !query.complete)?.query ?? null,
      coverage: await inputs.coverage.read({ fromDay: first.fromDay, toDay: first.toDay }, String(insertedTotal)),
    },
  }
}
