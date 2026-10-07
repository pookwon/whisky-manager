import { describe, expect, it } from 'vitest'
import { readBoardSearchView } from '../../src/desktop/boardSearchView.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'
import type { BoardSearchCoverageQuery } from '../../src/desktop/collection-db/boardSearchCoverageQuery.js'
import type { BoardSearchLastRun, BoardSearchLastRunQuery } from '../../src/desktop/collection-db/boardSearchLastRunQuery.js'

const row = (query: string, order: number, complete: boolean, inserted: number): BoardSearchQueryState => ({
  boardId: '137', query, fromDay: '20250101', toDay: '20250829', segmentToDay: null, queueOrder: order, expectedGain: 1, lastCommittedPage: complete ? 3 : null, insertedCount: inserted, totalCount: null, complete, lastRunId: null,
})
const coverage = { span: 10, missing: 4, baselineMissingRatio: 0.1, estimatedRemaining: 3 }

function inputs(rows: BoardSearchQueryState[], runs: Record<string, BoardSearchLastRun> = {}) {
  const seen: string[] = []
  const windows: string[] = []
  const repository = {
    listQueries: async () => rows,
    readBoardName: async (boardId: string) => (boardId === '137' ? '국내구입기 & 정보' : null),
  } as unknown as BoardSearchRepository
  const query: BoardSearchCoverageQuery = { read: async (_w, fingerprint) => { seen.push(fingerprint); return coverage } }
  const lastRuns: BoardSearchLastRunQuery = {
    read: async (job) => { windows.push(`${job.boardId} ${job.fromDay}-${job.toDay}`); return new Map(Object.entries(runs)) },
  }
  return { repository, coverage: query, lastRuns, running: false, progress: null, blockFailure: null, seen, windows }
}

describe('readBoardSearchView', () => {
  it('sums the job up and names the query walking next', async () => {
    const i = inputs([row('글렌', 1, true, 40), row('구매', 2, false, 5), row('이마트', 3, false, 0)])
    await expect(readBoardSearchView(i)).resolves.toMatchObject({
      job: { boardId: '137', boardName: '국내구입기 & 정보', fromDay: '20250101', toDay: '20250829', completedCount: 1, insertedTotal: 45, current: '구매', coverage },
    })
    // The coverage cache is keyed on what was inserted, so it re-reads only when posts arrived.
    expect(i.seen).toEqual(['45'])
  })

  it('puts each query\'s last run of the job\'s window beside it', async () => {
    const i = inputs([row('글렌', 1, false, 0), row('구매', 2, false, 0)], { 글렌: { status: 'failed', stopReason: 'BOARD_SEARCH_HTTP_ERROR' } })
    const view = await readBoardSearchView(i)
    expect(view.job?.queries.map((query) => [query.query, query.lastRun])).toEqual([
      ['글렌', { status: 'failed', stopReason: 'BOARD_SEARCH_HTTP_ERROR' }],
      ['구매', null],
    ])
    expect(i.windows).toEqual(['137 20250101-20250829'])
  })

  it('carries the block in flight\'s progress', async () => {
    const progress = { query: '구매', requestedPages: 12, maxPages: 60 }
    await expect(readBoardSearchView({ ...inputs([row('구매', 1, false, 0)]), running: true, progress })).resolves.toMatchObject({ running: true, progress })
  })

  it('carries the runner\'s last block failure, with a job or without one', async () => {
    const blockFailure = { code: 'COLLECTION_FAILURE', stopReason: 'COLLECTION_FAILURE: Error: x', atMs: 5 }
    await expect(readBoardSearchView({ ...inputs([row('글렌', 1, false, 0)]), blockFailure })).resolves.toMatchObject({ blockFailure })
    await expect(readBoardSearchView({ ...inputs([]), blockFailure })).resolves.toMatchObject({ blockFailure })
  })

  it('has no job without rows', async () => {
    const i = inputs([])
    await expect(readBoardSearchView(i)).resolves.toMatchObject({ job: null })
    expect(i.seen).toEqual([])
    expect(i.windows).toEqual([])
  })
})
