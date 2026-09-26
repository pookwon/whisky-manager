import { describe, expect, it, vi } from 'vitest'
import { createArticleProbeJob } from '../../src/desktop/articleProbeJob.js'
import type { ArticleProbeRunner } from '../../src/desktop/articleProbeRunner.js'
import type { ArticleProbeJob, ArticleProbeRepository } from '../../src/desktop/collection-db/articleProbeRepository.js'

const summary = (probed: number, total: number): ArticleProbeJob => ({ fromDay: '20250101', toDay: '20250829', total, probed, stored: 0, deleted: 0, unreadable: 0, otherBoard: 0, notice: 0 })

function job(state: ArticleProbeJob | null, storage = true) {
  const runner = { start: vi.fn(() => ({ kind: 'started' as const })), stop: vi.fn(), isRunning: () => false, progress: () => null, blockFailure: () => null } satisfies ArticleProbeRunner
  const repository = storage ? ({ readJob: async () => state } as unknown as ArticleProbeRepository) : null
  return { job: createArticleProbeJob({ repository: () => repository, runner }), runner }
}

describe('articleProbe job', () => {
  it('has work while any id waits', async () => {
    await expect(job(summary(3, 10)).job.readProgress()).resolves.toEqual({ exists: true, complete: false, forced: false })
  })

  it('is done when every id is answered', async () => {
    await expect(job(summary(10, 10)).job.readProgress()).resolves.toEqual({ exists: true, complete: true, forced: false })
  })

  it('does not exist without a job or storage', async () => {
    await expect(job(null).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
    await expect(job(summary(0, 1), false).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
  })

  it('starts a block with the budget it is given', () => {
    const { job: j, runner } = job(summary(0, 1))
    expect(j.name).toBe('articleProbe')
    expect(j.start(120)).toEqual({ kind: 'started' })
    expect(runner.start).toHaveBeenCalledWith({ maxPages: 120 })
  })
})
