import { describe, expect, it } from 'vitest'
import { readArticleProbeView } from '../../src/desktop/articleProbeView.js'
import type { ArticleProbeJob, ArticleProbeLastRun, ArticleProbeRepository, ArticleProbeWindowDays } from '../../src/desktop/collection-db/articleProbeRepository.js'
import type { CollectionPeriodDays } from '../../src/desktop/collectionPipelineStage.js'

const job: ArticleProbeJob = { fromDay: '20250101', toDay: '20250829', total: 9660, probed: 3120, stored: 684, deleted: 2391, unreadable: 45, otherBoard: 0, notice: 0 }
const lastRun: ArticleProbeLastRun = { status: 'failed', stopReason: 'ARTICLE_HTTP_ERROR: id 700001', startedAtMs: 1_790_000_000_000 }
const period: CollectionPeriodDays = { fromDay: '20250101', toDay: '20250829' }

function inputs(state: ArticleProbeJob | null, p: CollectionPeriodDays | null = period) {
  const asked: string[] = []
  const repository = {
    readJob: async (window: ArticleProbeWindowDays) => { asked.push(`job ${window.fromDay}-${window.toDay}`); return state },
    readLastRun: async () => lastRun,
  } as unknown as ArticleProbeRepository
  return { repository, period: p, running: false, progress: null, blockFailure: null, asked }
}

describe('readArticleProbeView', () => {
  it('calls readJob with the given period and returns the job', async () => {
    const i = inputs(job)
    await expect(readArticleProbeView(i)).resolves.toEqual({ running: false, progress: null, blockFailure: null, lastRun, job })
    expect(i.asked).toEqual(['job 20250101-20250829'])
  })

  it('does not call readJob and returns null job when period is null', async () => {
    const i = inputs(job, null)
    await expect(readArticleProbeView(i)).resolves.toMatchObject({ job: null })
    expect(i.asked).toEqual([])
  })

  it('carries the block in flight\'s progress', async () => {
    const progress = { requested: 40, maxPages: 60 }
    await expect(readArticleProbeView({ ...inputs(job), running: true, progress })).resolves.toMatchObject({ running: true, progress })
  })
})
