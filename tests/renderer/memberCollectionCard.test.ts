/**
 * Logic tests for the member collection card's derived display values.
 * These test the functions exported from memberCollectionCard.ts directly.
 */
import { describe, expect, it } from 'vitest'
import { TEXT } from '../../src/shared/text.js'
import type { MemberCollectionStatus } from '../../src/desktop/collection-db/memberStatusQuery.js'
import { progressLine, stopReasonLine } from '../../src/renderer/views/memberCollectionCard.js'

const base: MemberCollectionStatus = {
  memberCount: 0,
  pagesStored: 0,
  totalMemberCount: null,
  complete: false,
  forced: false,
  completedAtMs: null,
  toppedUpAtMs: null,
  running: false,
  authorCount: 0,
  matchedAuthorCount: 0,
  lastRunStatus: null,
  lastRunStopReason: null,
}

describe('member card — progressLine', () => {
  it('shows pages read when total is unknown (never-run state)', () => {
    const line = progressLine({ pagesStored: 0, totalMemberCount: null })
    expect(line).toBe(TEXT.memberCollection.pagesStored(0))
  })

  it('shows percentage when total is known', () => {
    const line = progressLine({ pagesStored: 5, totalMemberCount: 1000 })
    // 1000 members → 10 pages total; 5/10 = 50%
    expect(line).toBe(TEXT.memberCollection.progress(50))
  })

  it('clamps percentage to 100 when cursor overshoots', () => {
    const line = progressLine({ pagesStored: 999, totalMemberCount: 100 })
    expect(line).toBe(TEXT.memberCollection.progress(100))
  })

  it('clamps percentage to 0 for a zero cursor', () => {
    const line = progressLine({ pagesStored: 0, totalMemberCount: 1000 })
    expect(line).toBe(TEXT.memberCollection.progress(0))
  })
})

describe('member card — stopReasonLine', () => {
  it('returns null when no run has ever started', () => {
    expect(stopReasonLine({ ...base, lastRunStatus: null, lastRunStopReason: null })).toBeNull()
  })

  it('returns null while running', () => {
    expect(stopReasonLine({ ...base, running: true, lastRunStatus: 'running', lastRunStopReason: 'PAGE_BUDGET_SPENT' })).toBeNull()
  })

  it('shows a progress-toned message for PAGE_BUDGET_SPENT', () => {
    const line = stopReasonLine({ ...base, running: false, lastRunStatus: 'succeeded', lastRunStopReason: 'PAGE_BUDGET_SPENT' })
    expect(line).toBe(TEXT.memberCollection.stopReason['PAGE_BUDGET_SPENT'])
  })

  it('shows a progress-toned message for ABORTED', () => {
    const line = stopReasonLine({ ...base, running: false, lastRunStatus: 'succeeded', lastRunStopReason: 'ABORTED' })
    expect(line).toBe(TEXT.memberCollection.stopReason['ABORTED'])
  })

  it('shows a failure reason for a failed run', () => {
    const line = stopReasonLine({ ...base, running: false, lastRunStatus: 'failed', lastRunStopReason: 'MEMBER_PAGE_FORBIDDEN' })
    expect(line).toBe(TEXT.memberCollection.stopReason['MEMBER_PAGE_FORBIDDEN'])
  })

  it('falls back to the code itself for an unknown stop reason on a failed run', () => {
    const line = stopReasonLine({ ...base, running: false, lastRunStatus: 'failed', lastRunStopReason: 'FUTURE_CODE_XYZ' })
    expect(line).toBe(TEXT.memberCollection.stopReasonFallback('FUTURE_CODE_XYZ'))
  })

  it('returns null for a succeeded run with no stop reason', () => {
    expect(stopReasonLine({ ...base, running: false, lastRunStatus: 'succeeded', lastRunStopReason: null })).toBeNull()
  })

  it('returns null for a succeeded run with a non-failure, non-normal stop reason', () => {
    // A succeeded run that stopped for a reason that is neither normal nor failure should be silent.
    expect(stopReasonLine({ ...base, running: false, lastRunStatus: 'succeeded', lastRunStopReason: 'SOME_FUTURE_CODE' })).toBeNull()
  })

  it('shows a CAS-conflict reason for a partial run', () => {
    // CAS conflicts finish as partial (the run repositioned but did not fail).
    const line = stopReasonLine({ ...base, running: false, lastRunStatus: 'partial', lastRunStopReason: 'CAS_CONFLICT_REPOSITION_REQUIRED' })
    expect(line).toBe(TEXT.memberCollection.stopReason['CAS_CONFLICT_REPOSITION_REQUIRED'])
    expect(line).not.toBeNull()
  })

  it('shows fallback for an unknown stop reason on a partial run', () => {
    const line = stopReasonLine({ ...base, running: false, lastRunStatus: 'partial', lastRunStopReason: 'UNKNOWN_PARTIAL_CODE' })
    expect(line).toBe(TEXT.memberCollection.stopReasonFallback('UNKNOWN_PARTIAL_CODE'))
  })
})
