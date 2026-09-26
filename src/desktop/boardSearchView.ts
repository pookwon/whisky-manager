import type { BoardSearchCoverage, BoardSearchCoverageQuery } from './collection-db/boardSearchCoverageQuery.js'
import type { BoardSearchLastRun, BoardSearchLastRunQuery } from './collection-db/boardSearchLastRunQuery.js'
import type { BoardSearchQueryState, BoardSearchRepository, CollectableBoard } from './collection-db/boardSearchRepository.js'
import type { BoardSearchBlockFailure } from './boardSearchRunner.js'

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

/** What the search backfill screen shows: the boards it can pick, and the job if there is one. */
export interface BoardSearchView {
  readonly boards: readonly CollectableBoard[]
  readonly running: boolean
  /** Why the last block ended with no run row saying it; null once a block starts again. */
  readonly blockFailure: BoardSearchBlockFailure | null
  readonly job: BoardSearchJobView | null
}

export async function readBoardSearchView(inputs: {
  readonly repository: BoardSearchRepository
  readonly coverage: BoardSearchCoverageQuery
  readonly lastRuns: BoardSearchLastRunQuery
  readonly running: boolean
  readonly blockFailure: BoardSearchBlockFailure | null
}): Promise<BoardSearchView> {
  const [boards, queries] = await Promise.all([inputs.repository.listCollectableBoards(), inputs.repository.listQueries()])
  const first = queries[0]
  if (first === undefined) return { boards, running: inputs.running, blockFailure: inputs.blockFailure, job: null }
  const insertedTotal = queries.reduce((sum, query) => sum + query.insertedCount, 0)
  const lastRuns = await inputs.lastRuns.read({ boardId: first.boardId, fromDay: first.fromDay, toDay: first.toDay })
  return {
    boards,
    running: inputs.running,
    blockFailure: inputs.blockFailure,
    job: {
      boardId: first.boardId,
      boardName: boards.find((board) => board.boardId === first.boardId)?.name ?? null,
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
