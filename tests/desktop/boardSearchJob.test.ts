import { describe, expect, it, vi } from 'vitest'
import { createBoardSearchJob } from '../../src/desktop/boardSearchJob.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'
import type { BoardSearchRunner } from '../../src/desktop/boardSearchRunner.js'

const row = (complete: boolean): BoardSearchQueryState => ({
  boardId: '137', query: 'q', fromDay: '20250101', toDay: '20250829', queueOrder: 1, expectedGain: 1, lastCommittedPage: null, insertedCount: 0, totalCount: null, complete, lastRunId: null,
})

function job(rows: BoardSearchQueryState[] | null) {
  const runner = { start: vi.fn(() => ({ kind: 'started' as const })), stop: vi.fn(), isRunning: () => false } satisfies BoardSearchRunner
  const repository = rows === null ? null : ({ listQueries: async () => rows } as unknown as BoardSearchRepository)
  return { job: createBoardSearchJob({ repository: () => repository, runner }), runner }
}

describe('boardSearch job', () => {
  it('has work while any query is unfinished', async () => {
    await expect(job([row(true), row(false)]).job.readProgress()).resolves.toEqual({ exists: true, complete: false, forced: false })
  })

  it('is done when every query is', async () => {
    await expect(job([row(true)]).job.readProgress()).resolves.toEqual({ exists: true, complete: true, forced: false })
  })

  it('does not exist without rows or storage', async () => {
    await expect(job([]).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
    await expect(job(null).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
  })

  it('starts a block with the budget it is given', () => {
    const { job: j, runner } = job([row(false)])
    expect(j.start(120)).toEqual({ kind: 'started' })
    expect(runner.start).toHaveBeenCalledWith({ maxPages: 120 })
  })
})
