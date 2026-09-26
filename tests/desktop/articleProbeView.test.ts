import { describe, expect, it } from 'vitest'
import { readArticleProbeView } from '../../src/desktop/articleProbeView.js'
import type { ArticleProbeJob, ArticleProbeLastRun, ArticleProbeRepository } from '../../src/desktop/collection-db/articleProbeRepository.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'

const job: ArticleProbeJob = { fromDay: '20250101', toDay: '20250829', total: 9660, probed: 3120, stored: 684, deleted: 2391, unreadable: 45, otherBoard: 0, notice: 0 }
const lastRun: ArticleProbeLastRun = { status: 'failed', stopReason: 'ARTICLE_HTTP_ERROR: id 700001', startedAtMs: 1_790_000_000_000 }
const finished: BoardSearchQueryState = {
  boardId: '137', query: 'q', fromDay: '20250101', toDay: '20250829', segmentToDay: null, queueOrder: 1, expectedGain: 1, lastCommittedPage: 3, insertedCount: 0, totalCount: null, complete: true, lastRunId: null,
}

function inputs(state: ArticleProbeJob | null) {
  const searched: string[] = []
  const repository = { readJob: async () => state, readLastRun: async () => lastRun } as unknown as ArticleProbeRepository
  const search = { listQueries: async () => { searched.push('listQueries'); return [finished] } } as unknown as BoardSearchRepository
  return { repository, search, running: false, progress: null, blockFailure: null, searched }
}

describe('readArticleProbeView', () => {
  it('carries the job and its last run, and asks nothing of the search job once there is one', async () => {
    const i = inputs(job)
    await expect(readArticleProbeView(i)).resolves.toEqual({ running: false, progress: null, blockFailure: null, lastRun, job, window: null })
    expect(i.searched).toEqual([])
  })

  it('says which window a job would take while there is none', async () => {
    await expect(readArticleProbeView(inputs(null))).resolves.toMatchObject({ job: null, window: { kind: 'ready', fromDay: '20250101', toDay: '20250829' } })
  })

  it('carries the block in flight\'s progress', async () => {
    const progress = { requested: 40, maxPages: 60 }
    await expect(readArticleProbeView({ ...inputs(job), running: true, progress })).resolves.toMatchObject({ running: true, progress })
  })
})
