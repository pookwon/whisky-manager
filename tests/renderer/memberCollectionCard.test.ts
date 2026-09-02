/**
 * Logic tests for the member collection card's derived display values.
 * The card is rendered in a pure-Node environment without JSX, so these tests
 * verify the progress and stop-reason computations directly rather than mounting
 * the component.
 */
import { describe, expect, it } from 'vitest'
import { TEXT } from '../../src/shared/text.js'
import type { MemberCollectionStatus } from '../../src/desktop/collection-db/memberStatusQuery.js'

// Mirrors the card's progressLine logic.
function progressLine(status: Pick<MemberCollectionStatus, 'pagesStored' | 'totalMemberCount'>): string {
  const { pagesStored, totalMemberCount } = status
  if (totalMemberCount !== null && totalMemberCount > 0) {
    const percent = Math.min(100, Math.max(0, Math.round((pagesStored / (totalMemberCount / 100)) * 100)))
    return TEXT.memberCollection.progress(percent)
  }
  return TEXT.memberCollection.pagesStored(pagesStored)
}

// Mirrors the card's stopReasonLine logic.
function stopReasonLine(status: Pick<MemberCollectionStatus, 'running' | 'lastRunStatus' | 'lastRunStopReason'>): string | null {
  const { running, lastRunStatus, lastRunStopReason } = status
  if (running || lastRunStopReason === null) return null
  const normal = new Set(['PAGE_BUDGET_SPENT', 'ABORTED'])
  if (normal.has(lastRunStopReason)) {
    return TEXT.memberCollection.stopReason[lastRunStopReason] ?? TEXT.memberCollection.stopReasonFallback(lastRunStopReason)
  }
  if (lastRunStatus === 'failed') {
    return TEXT.memberCollection.stopReason[lastRunStopReason] ?? TEXT.memberCollection.stopReasonFallback(lastRunStopReason)
  }
  return null
}

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
    // Must not show the unresolvable placeholder
    expect(line).not.toBe(TEXT.memberCollection.progressUnknown)
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

  it('returns null for a complete walk (stop reason present but not failure or normal)', () => {
    // A succeeded run that stopped for some non-normal, non-failure reason should be silent.
    expect(stopReasonLine({ ...base, running: false, lastRunStatus: 'succeeded', lastRunStopReason: 'MEMBER_PAGE_REPEATED' })).toBeNull()
  })
})
