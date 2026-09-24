import { describe, expect, it } from 'vitest'
import {
  boardSearchCoverageLine,
  boardSearchQueryState,
  boardSearchSummaryLine,
  dayKeyLabel,
  dayKeyOfDateInput,
} from '../../src/renderer/views/collection/boardSearchLines.js'
import type { BoardSearchQueryState } from '../../src/desktop/collection-db/boardSearchRepository.js'

const query = (q: string, complete: boolean): BoardSearchQueryState => ({
  boardId: '137', query: q, fromDay: '20250101', toDay: '20250829', queueOrder: 1, expectedGain: 1, lastCommittedPage: null, insertedCount: 0, totalCount: null, complete, lastRunId: null,
})

describe('board search wording', () => {
  it('spells day keys the way the screens spell dates', () => {
    expect(dayKeyLabel('20250101')).toBe('2025-01-01')
    expect(dayKeyOfDateInput('2025-01-01')).toBe('20250101')
  })

  it('sums a job in one line', () => {
    const line = boardSearchSummaryLine({
      boardId: '137', boardName: '국내구입기 & 정보', fromDay: '20250101', toDay: '20250829',
      queries: [query('글렌', true), query('구매', false)], completedCount: 1, insertedTotal: 1234, current: '구매',
      coverage: { span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null },
    })
    expect(line).toContain('1 / 2')
    expect(line).toContain('1,234')
    expect(line).toContain('구매')
  })

  it('shows the residual only when it can be estimated', () => {
    expect(boardSearchCoverageLine({ span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null })).toBeNull()
    expect(boardSearchCoverageLine({ span: 111_973, missing: 41_545, baselineMissingRatio: 0.067, estimatedRemaining: 34_043 })).toContain('34,043')
  })

  it('tells a finished, walking and waiting query apart', () => {
    expect(boardSearchQueryState(query('글렌', true), '구매', true)).toBe('done')
    expect(boardSearchQueryState(query('구매', false), '구매', true)).toBe('walking')
    expect(boardSearchQueryState(query('구매', false), '구매', false)).toBe('waiting')
    expect(boardSearchQueryState(query('이마트', false), '구매', true)).toBe('waiting')
  })
})
