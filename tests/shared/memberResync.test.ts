import { describe, expect, it } from 'vitest'
import { isMemberResyncDue, nextMemberResyncDueMs } from '../../src/shared/memberResync.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const kst = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 16).replace('T', ' ')
/** 2026-09-15 23:30 KST, late on the day the first walk finished. */
const WALK_DONE = Date.UTC(2026, 8, 15, 14, 30)
/** 2026-11-01 10:00 KST. */
const NOV_1 = Date.UTC(2026, 10, 1, 1)
const timing = (overrides: Partial<{ enabled: boolean; walkCompletedAtMs: number | null; resyncCompletedAtMs: number | null }> = {}) =>
  ({ enabled: true, walkCompletedAtMs: WALK_DONE, resyncCompletedAtMs: null, ...overrides }) as const

describe('member re-walk timing', () => {
  it('is due on each of the first three KST days of a month', () => {
    expect(isMemberResyncDue(timing(), NOV_1)).toBe(true)
    expect(isMemberResyncDue(timing(), NOV_1 + DAY)).toBe(true)
    expect(isMemberResyncDue(timing(), NOV_1 + 2 * DAY)).toBe(true)
  })

  it('is not due outside those days, however long ago the last pass was', () => {
    expect(isMemberResyncDue(timing(), NOV_1 + 3 * DAY)).toBe(false)
    expect(isMemberResyncDue(timing(), Date.UTC(2026, 9, 31, 14, 59))).toBe(false)
  })

  it('reads the month boundary in KST, not UTC', () => {
    const justBefore = Date.UTC(2026, 9, 31, 14, 59) // 2026-10-31 23:59 KST
    const justAfter = Date.UTC(2026, 9, 31, 15, 0) // 2026-11-01 00:00 KST
    expect(isMemberResyncDue(timing(), justBefore)).toBe(false)
    expect(isMemberResyncDue(timing(), justAfter)).toBe(true)
  })

  it('is not due when a complete pass is from the last week', () => {
    const resyncDone = Date.UTC(2026, 9, 28, 2) // 2026-10-28 11:00 KST
    expect(isMemberResyncDue(timing({ resyncCompletedAtMs: resyncDone }), NOV_1)).toBe(false)
  })

  it('is due again once that pass is a week old, within the window', () => {
    const resyncDone = Date.UTC(2026, 9, 28, 2)
    expect(isMemberResyncDue(timing({ resyncCompletedAtMs: resyncDone }), NOV_1 + 3 * DAY)).toBe(false)
    expect(isMemberResyncDue(timing({ resyncCompletedAtMs: Date.UTC(2026, 9, 24, 2) }), NOV_1 + DAY)).toBe(true)
  })

  it('is due when last month had no pass at all, and when it was a month ago', () => {
    expect(isMemberResyncDue(timing({ resyncCompletedAtMs: Date.UTC(2026, 9, 2, 2) }), NOV_1)).toBe(true)
  })

  it('never falls due before the first walk finished or while it is off', () => {
    expect(isMemberResyncDue(timing({ walkCompletedAtMs: null }), NOV_1)).toBe(false)
    expect(nextMemberResyncDueMs(timing({ walkCompletedAtMs: null }), NOV_1)).toBeNull()
    expect(isMemberResyncDue(timing({ enabled: false }), NOV_1)).toBe(false)
    expect(nextMemberResyncDueMs(timing({ enabled: false }), NOV_1)).toBeNull()
  })

  it('names today as the next due day while it is owed', () => {
    expect(kst(nextMemberResyncDueMs(timing(), NOV_1) ?? 0)).toBe('2026-11-01 00:00')
  })

  it('names the first of next month once this window has passed', () => {
    expect(kst(nextMemberResyncDueMs(timing(), NOV_1 + 10 * DAY) ?? 0)).toBe('2026-12-01 00:00')
  })

  it('rolls over the year', () => {
    expect(kst(nextMemberResyncDueMs(timing(), Date.UTC(2026, 11, 10, 3)) ?? 0)).toBe('2027-01-01 00:00')
  })

  it('skips a window whose days all fall within a week of the last pass', () => {
    const resyncDone = Date.UTC(2026, 10, 3, 2) // 2026-11-03 11:00 KST
    expect(kst(nextMemberResyncDueMs(timing({ resyncCompletedAtMs: resyncDone }), NOV_1 + 5 * DAY) ?? 0)).toBe('2026-12-01 00:00')
  })
})
