import { describe, expect, it } from 'vitest'
import {
  countByKstHour,
  isKstDayKey,
  kstDayKey,
  kstDayKeyRange,
  kstDayRange,
  kstDayStartMs,
  kstHourOf,
  kstLocalDateTimeToEpochMs,
  kstMonthRange,
  recentCompletedKstDays,
} from '../../src/shared/kst.js'

describe('kstDayStartMs', () => {
  it('is midnight in KST, not in UTC', () => {
    // 2026-08-24 01:39 KST is 2026-08-23 16:39 UTC, and that KST day begins at
    // 2026-08-23 15:00 UTC. Asserting the absolute instant is the point: a
    // whole-day offset keeps every relative property intact and still collects
    // the wrong posts.
    expect(kstDayStartMs(Date.UTC(2026, 7, 23, 16, 39))).toBe(Date.UTC(2026, 7, 23, 15, 0))
  })

  it('never returns a moment later than the one it was given', () => {
    // A floor in the future matches nothing, which is how a collector reports
    // an empty board instead of a broken clock.
    for (const hour of [15, 16, 20, 23]) {
      const instant = Date.UTC(2026, 7, 23, hour)
      expect(kstDayStartMs(instant)).toBeLessThanOrEqual(instant)
    }
    const earlyKstMorning = Date.UTC(2026, 7, 23, 15, 1)
    expect(kstDayStartMs(earlyKstMorning)).toBeLessThanOrEqual(earlyKstMorning)
  })

  it('returns the epoch ms of midnight KST for the given epoch ms', () => {
    // 2026-08-23 00:30 KST falls on 2026-08-23 KST, so its day start is 2026-08-22 15:00 UTC
    const justAfterKstMidnight = Date.UTC(2026, 7, 22, 15, 30)
    // 2026-08-23 23:00 KST also falls on 2026-08-23 KST, so its day start is the same
    const lateSameKstDay = Date.UTC(2026, 7, 23, 14, 0)
    // Day start should be consistent within same KST day
    expect(kstDayStartMs(justAfterKstMidnight)).toBe(kstDayStartMs(lateSameKstDay))
  })

  it('distinguishes between different KST days', () => {
    const day1End = Date.UTC(2026, 7, 22, 14, 59) // Still 2026-08-22 KST
    const day2Start = Date.UTC(2026, 7, 22, 15, 0) // 2026-08-23 00:00 KST
    expect(kstDayStartMs(day1End)).not.toBe(kstDayStartMs(day2Start))
  })
})

describe('collection KST ranges', () => {
  it('anchors development collection to the three completed KST days', () => {
    // 2026-08-30 09:30 KST: today is still incomplete and excluded.
    expect(recentCompletedKstDays(Date.UTC(2026, 7, 30, 0, 30))).toEqual({
      startMs: Date.UTC(2026, 7, 26, 15),
      endMs: Date.UTC(2026, 7, 29, 15),
    })
  })

  it('uses KST midnight for an explicit month, including the next-month boundary', () => {
    expect(kstMonthRange(2026, 7)).toEqual({ startMs: Date.UTC(2026, 5, 30, 15), endMs: Date.UTC(2026, 6, 31, 15) })
  })
})

describe('kstDayRange', () => {
  it('is half open, so the next day begins exactly where this one ends', () => {
    const day = kstDayRange(Date.UTC(2026, 7, 23, 16, 39))
    expect(day.startMs).toBe(kstDayStartMs(Date.UTC(2026, 7, 23, 16, 39)))
    expect(kstDayStartMs(day.endMs)).toBe(day.endMs)
    expect(kstDayStartMs(day.endMs - 1)).toBe(day.startMs)
  })

  it('holds the instant it was asked about', () => {
    const instant = Date.UTC(2026, 7, 23, 16, 39)
    const day = kstDayRange(instant)
    expect(instant).toBeGreaterThanOrEqual(day.startMs)
    expect(instant).toBeLessThan(day.endMs)
  })
})

describe('countByKstHour', () => {
  it('buckets each instant by the KST hour it fell in', () => {
    // 2026-08-24 09:05 and 09:50 KST, and 23:59 KST the same day.
    const nineFive = Date.UTC(2026, 7, 24, 0, 5)
    const nineFifty = Date.UTC(2026, 7, 24, 0, 50)
    const lateNight = Date.UTC(2026, 7, 24, 14, 59)

    const counts = countByKstHour([nineFive, lateNight, nineFifty])

    expect(counts).toHaveLength(24)
    expect(counts[9]).toBe(2)
    expect(counts[23]).toBe(1)
    expect(counts.reduce((total, n) => total + n, 0)).toBe(3)
  })

  it('reads the hour on the KST clock, not the machine clock', () => {
    // 23:30 UTC is 08:30 KST the next day.
    expect(countByKstHour([Date.UTC(2026, 7, 23, 23, 30)])[8]).toBe(1)
  })

  it('answers an empty day with twenty-four zeros', () => {
    expect(countByKstHour([])).toEqual(Array.from({ length: 24 }, () => 0))
  })
})

describe('kstHourOf', () => {
  it('reads the hour on the cafe clock, whatever the machine is set to', () => {
    // 00:30 KST is 15:30 the previous day in UTC; reading UTC hours here would
    // put a nought-thirty block in the middle of the previous afternoon.
    expect(kstHourOf(Date.parse('2026-08-24T00:30:00+09:00'))).toBe(0)
    expect(kstHourOf(Date.parse('2026-08-24T23:59:00+09:00'))).toBe(23)
  })
})

describe('KST day keys', () => {
  it('names the KST day of an instant, not the UTC one', () => {
    // 2025-01-31 15:30 UTC is 2025-02-01 00:30 KST.
    expect(kstDayKey(Date.UTC(2025, 0, 31, 15, 30))).toBe('20250201')
    expect(kstDayKey(Date.UTC(2025, 0, 31, 14, 59, 59, 999))).toBe('20250131')
  })

  it('accepts only real calendar days', () => {
    expect(isKstDayKey('20250228')).toBe(true)
    expect(isKstDayKey('20250229')).toBe(false)
    expect(isKstDayKey('2025-01-01')).toBe(false)
    expect(isKstDayKey('2025011')).toBe(false)
  })

  it('turns a key back into the KST day it names', () => {
    const day = kstDayKeyRange('20250101')
    expect(day.startMs).toBe(Date.UTC(2024, 11, 31, 15))
    expect(day.endMs - day.startMs).toBe(86_400_000)
    expect(kstDayKey(day.startMs)).toBe('20250101')
    expect(() => kstDayKeyRange('20251301')).toThrow()
  })

  it('reads an offset-less wall-clock time as KST', () => {
    // Stored post 661354 was written 2025-01-16 12:13:05.183 KST; the search
    // API spells it this way.
    expect(kstLocalDateTimeToEpochMs('2025-01-16T12:13:05.183')).toBe(Date.UTC(2025, 0, 16, 3, 13, 5, 183))
    expect(kstLocalDateTimeToEpochMs('2025-01-16T12:13:05')).toBe(Date.UTC(2025, 0, 16, 3, 13, 5))
    expect(kstLocalDateTimeToEpochMs('2025-01-16T12:13:05.1')).toBe(Date.UTC(2025, 0, 16, 3, 13, 5, 100))
  })

  it('refuses a time it cannot read rather than guessing', () => {
    expect(kstLocalDateTimeToEpochMs('2025-01-16 12:13:05')).toBeNull()
    expect(kstLocalDateTimeToEpochMs('2025-01-16T12:13:05+09:00')).toBeNull()
    expect(kstLocalDateTimeToEpochMs('2025-02-30T00:00:00')).toBeNull()
    expect(kstLocalDateTimeToEpochMs('2025-01-16T24:00:00')).toBeNull()
  })
})
