import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS,
  isMemberResyncDue,
  nextMemberResyncDueMs,
  normalizeMemberResyncInterval,
} from '../../src/shared/memberResync.js'

const HOUR = 3_600_000
const kst = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 16).replace('T', ' ')
/** 2026-09-15 23:30 KST, late on the day the first walk finished. */
const WALK_DONE = Date.UTC(2026, 8, 15, 14, 30)

describe('member re-walk timing', () => {
  it('is due the interval of KST days after the day the first walk finished, at KST midnight', () => {
    const due = nextMemberResyncDueMs({ intervalDays: 30, walkCompletedAtMs: WALK_DONE, resyncCompletedAtMs: null })
    expect(kst(due ?? 0)).toBe('2026-10-15 00:00')
  })

  it('counts from the last re-walk once there has been one', () => {
    const resyncDone = Date.UTC(2026, 9, 24, 2) // 2026-10-24 11:00 KST
    const due = nextMemberResyncDueMs({ intervalDays: 14, walkCompletedAtMs: WALK_DONE, resyncCompletedAtMs: resyncDone })
    expect(kst(due ?? 0)).toBe('2026-11-07 00:00')
  })

  it('never falls due before the first walk finished or while it is off', () => {
    expect(nextMemberResyncDueMs({ intervalDays: 30, walkCompletedAtMs: null, resyncCompletedAtMs: null })).toBeNull()
    expect(nextMemberResyncDueMs({ intervalDays: 0, walkCompletedAtMs: WALK_DONE, resyncCompletedAtMs: null })).toBeNull()
    expect(isMemberResyncDue({ intervalDays: 0, walkCompletedAtMs: WALK_DONE, resyncCompletedAtMs: null }, Date.UTC(2030, 0, 1))).toBe(false)
  })

  it('turns due on the stroke of KST midnight, not a moment before', () => {
    const timing = { intervalDays: 30, walkCompletedAtMs: WALK_DONE, resyncCompletedAtMs: null } as const
    const due = nextMemberResyncDueMs(timing) ?? 0
    expect(isMemberResyncDue(timing, due - 1)).toBe(false)
    expect(isMemberResyncDue(timing, due)).toBe(true)
  })

  it('reads anything but an offered choice as the default', () => {
    expect(normalizeMemberResyncInterval(14)).toBe(14)
    expect(normalizeMemberResyncInterval(0)).toBe(0)
    expect(normalizeMemberResyncInterval(7)).toBe(DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS)
    expect(normalizeMemberResyncInterval('30')).toBe(DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS)
  })
})
