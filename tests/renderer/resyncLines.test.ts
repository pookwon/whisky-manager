import { describe, expect, it } from 'vitest'
import { resyncScheduleLine, resyncStateLine, resyncStopLine } from '../../src/renderer/views/members/resyncLines.js'
import type { MemberResyncView } from '../../src/desktop/memberResyncView.js'
import { TEXT } from '../../src/shared/text.js'

/** 2026-09-24 10:00 KST. */
const NOW = Date.UTC(2026, 8, 24, 1)

const idle: MemberResyncView = {
  intervalDays: 30,
  available: true,
  inProgress: false,
  running: false,
  scheduleEnabled: true,
  lastRun: null,
  pagesStored: 0,
  cycleStartedAtMs: null,
  completedAtMs: null,
  nextDueAtMs: Date.UTC(2026, 9, 14, 15), // 2026-10-15 00:00 KST
}

describe('member re-walk card lines', () => {
  it('says there is nothing to walk again before the first walk has finished', () => {
    const view = { ...idle, available: false, nextDueAtMs: null }
    expect(resyncStateLine(view, null)).toBe(TEXT.memberResync.notYet)
    expect(resyncScheduleLine(view, NOW)).toBeNull()
  })

  it('shows progress through the list and when the cycle began, in KST', () => {
    const view = { ...idle, inProgress: true, pagesStored: 500, cycleStartedAtMs: Date.UTC(2026, 8, 23, 23, 30) }
    const line = resyncStateLine(view, 209_500)
    expect(line).toContain('500 / 2,095쪽')
    expect(line).toContain(TEXT.memberResync.startedAt('09-24 08:30'))
    expect(resyncScheduleLine(view, NOW)).toBeNull()
  })

  it('names the last completed pass and the KST day the next one is due', () => {
    const view = { ...idle, completedAtMs: Date.UTC(2026, 8, 20, 6) }
    expect(resyncStateLine(view, 209_500)).toBe(TEXT.memberResync.completedAt('09-20 15:00'))
    expect(resyncScheduleLine(view, NOW)).toBe(TEXT.memberResync.nextDue('2026-10-15'))
  })

  it('says a due pass starts with the next block, and says so when the automatic pass is off', () => {
    expect(resyncStateLine(idle, null)).toBe(TEXT.memberResync.never)
    expect(resyncScheduleLine({ ...idle, nextDueAtMs: NOW - 1 }, NOW)).toBe(TEXT.memberResync.nextDueNow)
    expect(resyncScheduleLine({ ...idle, intervalDays: 0, nextDueAtMs: null }, NOW)).toBe(TEXT.memberResync.off)
  })

  it('does not promise an automatic pass while the collection schedule is off', () => {
    expect(resyncScheduleLine({ ...idle, scheduleEnabled: false, nextDueAtMs: NOW - 1 }, NOW)).toBe(TEXT.memberResync.scheduleOff)
  })

  it('says why the last re-walk block stopped, and nothing while one is reading', () => {
    const failed = { ...idle, inProgress: true, lastRun: { status: 'failed', stopReason: 'MEMBER_PAGE_FORBIDDEN' } }
    expect(resyncStopLine(failed)).toBe(TEXT.memberCollection.stopReason.MEMBER_PAGE_FORBIDDEN)
    expect(resyncStopLine({ ...failed, running: true })).toBeNull()
    expect(resyncStopLine({ ...idle, lastRun: { status: 'succeeded', stopReason: null } })).toBeNull()
  })
})
