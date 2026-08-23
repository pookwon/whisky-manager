import { describe, expect, it } from 'vitest'
import { kstDayStartMs } from '../../src/shared/kst.js'

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
