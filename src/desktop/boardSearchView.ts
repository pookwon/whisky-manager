import type { BoardSearchCoverage, BoardSearchCoverageQuery } from './collection-db/boardSearchCoverageQuery.js'
import type { BoardSearchQueryState, BoardSearchRepository, CollectableBoard } from './collection-db/boardSearchRepository.js'

/** The search job in hand, summed up for the screen. */
export interface BoardSearchJobView {
  readonly boardId: string
  readonly boardName: string | null
  readonly fromDay: string
  readonly toDay: string
  readonly queries: readonly BoardSearchQueryState[]
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
  readonly job: BoardSearchJobView | null
}

export async function readBoardSearchView(inputs: {
  readonly repository: BoardSearchRepository
  readonly coverage: BoardSearchCoverageQuery
  readonly running: boolean
}): Promise<BoardSearchView> {
  const [boards, queries] = await Promise.all([inputs.repository.listCollectableBoards(), inputs.repository.listQueries()])
  const first = queries[0]
  if (first === undefined) return { boards, running: inputs.running, job: null }
  const insertedTotal = queries.reduce((sum, query) => sum + query.insertedCount, 0)
  return {
    boards,
    running: inputs.running,
    job: {
      boardId: first.boardId,
      boardName: boards.find((board) => board.boardId === first.boardId)?.name ?? null,
      fromDay: first.fromDay,
      toDay: first.toDay,
      queries,
      completedCount: queries.filter((query) => query.complete).length,
      insertedTotal,
      current: queries.find((query) => !query.complete)?.query ?? null,
      coverage: await inputs.coverage.read({ fromDay: first.fromDay, toDay: first.toDay }, String(insertedTotal)),
    },
  }
}
