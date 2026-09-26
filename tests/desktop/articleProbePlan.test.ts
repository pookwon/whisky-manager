import { describe, expect, it } from 'vitest'
import { articleProbeWindow } from '../../src/desktop/articleProbePlan.js'
import type { BoardSearchQueryState } from '../../src/desktop/collection-db/boardSearchRepository.js'

const row = (complete: boolean): BoardSearchQueryState => ({
  boardId: '137', query: 'q', fromDay: '20250101', toDay: '20250829', segmentToDay: null, queueOrder: 1, expectedGain: 1, lastCommittedPage: null, insertedCount: 0, totalCount: null, complete, lastRunId: null,
})

describe('articleProbeWindow', () => {
  it('takes the search job\'s window once every query of it has finished', () => {
    expect(articleProbeWindow([row(true), row(true)])).toEqual({ kind: 'ready', fromDay: '20250101', toDay: '20250829' })
  })

  it('refuses before there is a search job, and while one is unfinished', () => {
    expect(articleProbeWindow([])).toEqual({ kind: 'refused', reason: 'NO_SEARCH_JOB' })
    expect(articleProbeWindow([row(true), row(false)])).toEqual({ kind: 'refused', reason: 'SEARCH_NOT_FINISHED' })
  })
})
