import { describe, expect, it, vi } from 'vitest'
import { createArticleProbeJob } from '../../src/desktop/articleProbeJob.js'
import type { ArticleProbeRunner } from '../../src/desktop/articleProbeRunner.js'
import type { ArticleProbeJob, ArticleProbeRepository, ArticleProbeWindowDays } from '../../src/desktop/collection-db/articleProbeRepository.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'

const summary = (probed: number, total: number): ArticleProbeJob => ({ fromDay: '20250101', toDay: '20250829', total, probed, stored: 0, deleted: 0, unreadable: 0, otherBoard: 0, notice: 0 })
const finished: BoardSearchQueryState = {
  boardId: '137', query: 'q', fromDay: '20250101', toDay: '20250829', segmentToDay: null, queueOrder: 1, expectedGain: 1, lastCommittedPage: 3, insertedCount: 0, totalCount: null, complete: true, lastRunId: null,
}
const WINDOW = { fromDay: '20250101', toDay: '20250829' }

function job(state: ArticleProbeJob | null, setup: { readonly storage?: boolean; readonly queries?: readonly BoardSearchQueryState[] } = {}) {
  const runner = { start: vi.fn(() => ({ kind: 'started' as const })), stop: vi.fn(), isRunning: () => false, progress: () => null, blockFailure: () => null } satisfies ArticleProbeRunner
  const readJob = vi.fn(async (_window: ArticleProbeWindowDays) => state)
  const storage = setup.storage !== false
  const repository = storage ? ({ readJob } as unknown as ArticleProbeRepository) : null
  const search = storage ? ({ listQueries: async () => setup.queries ?? [finished] } as unknown as BoardSearchRepository) : null
  return { job: createArticleProbeJob({ repository: () => repository, search: () => search, runner }), runner, readJob }
}

describe('articleProbe job', () => {
  it('has work while any id of the search job\'s window waits', async () => {
    const j = job(summary(3, 10))
    await expect(j.job.readProgress()).resolves.toEqual({ exists: true, complete: false, forced: false })
    expect(j.readJob).toHaveBeenCalledWith(WINDOW)
  })

  it('is done when every id is answered', async () => {
    await expect(job(summary(10, 10)).job.readProgress()).resolves.toEqual({ exists: true, complete: true, forced: false })
  })

  it('does not exist without a job, a finished search job or storage', async () => {
    await expect(job(null).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
    await expect(job(summary(0, 1), { queries: [{ ...finished, complete: false }] }).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
    await expect(job(summary(0, 1), { storage: false }).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
  })

  it('starts a block on the search job\'s window with the budget it is given', async () => {
    const { job: j, runner } = job(summary(0, 1))
    expect(j.name).toBe('articleProbe')
    await j.readProgress()
    expect(j.start(120)).toEqual({ kind: 'started' })
    expect(runner.start).toHaveBeenCalledWith({ maxPages: 120, window: WINDOW })
  })

  it('refuses to start before a window is known', async () => {
    const { job: j, runner } = job(summary(0, 1), { queries: [] })
    expect(j.start(120)).toEqual({ kind: 'refused', reason: 'NO_JOB' })
    await j.readProgress()
    expect(j.start(120)).toEqual({ kind: 'refused', reason: 'NO_JOB' })
    expect(runner.start).not.toHaveBeenCalled()
  })
})
