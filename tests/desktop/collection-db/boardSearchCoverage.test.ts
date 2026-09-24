import { describe, expect, it } from 'vitest'
import { summarizeBoardSearchCoverage } from '../../../src/desktop/collection-db/boardSearchCoverageQuery.js'

describe('summarizeBoardSearchCoverage', () => {
  it('subtracts the gaps a complete stretch has anyway (deletions, uncollected boards)', () => {
    // 2026-09-25: the gap spans 111,973 ids with 70,428 stored; the complete
    // stretch after it misses 6.7%.
    const result = summarizeBoardSearchCoverage(
      { minId: 653_985, maxId: 765_957, stored: 70_428 },
      { minId: 1, maxId: 43_092, stored: 40_186 },
    )
    expect(result.span).toBe(111_973)
    expect(result.missing).toBe(41_545)
    expect(result.baselineMissingRatio).toBeCloseTo(2_906 / 43_092, 6)
    expect(result.estimatedRemaining).toBe(Math.round(41_545 - 111_973 * (2_906 / 43_092)))
  })

  it('says nothing it cannot know', () => {
    expect(summarizeBoardSearchCoverage({ minId: null, maxId: null, stored: 0 }, { minId: null, maxId: null, stored: 0 })).toEqual({
      span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null,
    })
  })

  it('never estimates a negative remainder', () => {
    const result = summarizeBoardSearchCoverage({ minId: 1, maxId: 100, stored: 99 }, { minId: 1, maxId: 100, stored: 90 })
    expect(result.estimatedRemaining).toBe(0)
  })
})
