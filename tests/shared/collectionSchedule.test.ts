import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLLECTION_SCHEDULE,
  checkCollectionRange,
  collectionRangeOfDays,
  nextCollectionRun,
  normalizeCollectionSchedule,
  scheduledCollectionRange,
} from '../../src/shared/collectionSchedule.js'

const DAY = 86_400_000
const HOUR = 3_600_000
/** 2026-08-31 09:00 KST. */
const NOW = Date.UTC(2026, 7, 31, 0, 0)
const kst = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 16).replace('T', ' ')

const enabled = { ...DEFAULT_COLLECTION_SCHEDULE, enabled: true }

describe('collection schedule', () => {
  it('lays the cycle on the cafe clock, not on when the app happened to start', () => {
    // 02:00 base, six-hour interval: the grid is 02, 08, 14, 20 KST whatever
    // time it is asked at.
    expect(kst(nextCollectionRun(NOW, enabled) ?? 0)).toBe('2026-08-31 14:00')
    expect(kst(nextCollectionRun(NOW + 6 * HOUR, enabled) ?? 0)).toBe('2026-08-31 20:00')
    // Past the last slot of the day it rolls to the next day's first.
    expect(kst(nextCollectionRun(Date.UTC(2026, 7, 31, 12), enabled) ?? 0)).toBe('2026-09-01 02:00')
  })

  it('keeps daily and twelve-hour cycles on the same anchor', () => {
    expect(kst(nextCollectionRun(NOW, { ...enabled, interval: 'DAILY' }) ?? 0)).toBe('2026-09-01 02:00')
    expect(kst(nextCollectionRun(NOW, { ...enabled, interval: 'TWELVE_HOURS' }) ?? 0)).toBe('2026-08-31 14:00')
  })

  it('schedules nothing when switched off or left to the operator', () => {
    expect(nextCollectionRun(NOW, { ...enabled, enabled: false })).toBeNull()
    // MANUAL is not off: the feature is on, and every run is started by hand.
    expect(nextCollectionRun(NOW, { ...enabled, interval: 'MANUAL' })).toBeNull()
  })

  it('asks for the configured window ending now', () => {
    const range = scheduledCollectionRange(NOW, { ...enabled, rangeDays: 3 })
    expect(range.endMs).toBe(NOW)
    expect(range.startMs).toBe(NOW - 3 * DAY)
  })

  it('turns two chosen dates into whole KST days', () => {
    // Both instants land inside 2026-08-28 and 2026-08-30 on the cafe clock,
    // whatever hour they carry: the window is the days, start to end.
    const range = collectionRangeOfDays(Date.UTC(2026, 7, 27, 20), Date.UTC(2026, 7, 30, 5))
    expect(kst(range.startMs)).toBe('2026-08-28 00:00')
    expect(kst(range.endMs)).toBe('2026-08-31 00:00')
  })

  it('refuses a window it cannot collect, and says which way it is wrong', () => {
    expect(checkCollectionRange({ startMs: NOW - DAY, endMs: NOW }, NOW)).toBeNull()
    expect(checkCollectionRange({ startMs: NOW, endMs: NOW }, NOW)).toBe('EMPTY_RANGE')
    expect(checkCollectionRange({ startMs: NOW + DAY, endMs: NOW + 2 * DAY }, NOW)).toBe('NOT_YET')
    expect(checkCollectionRange({ startMs: NOW - 40 * DAY, endMs: NOW }, NOW)).toBe('TOO_LONG')
  })

  it('brings anything stored back into a shape the loop can run', () => {
    // Whatever a hand-edited settings row holds, the loop gets a usable value.
    expect(normalizeCollectionSchedule({ interval: 'HOURLY' as never, rangeDays: 900, maxPages: 0 })).toEqual({
      enabled: false,
      interval: 'SIX_HOURS',
      baseMinuteOfDayKst: 120,
      rangeDays: 31,
      maxPages: 1,
    })
    expect(normalizeCollectionSchedule({ baseMinuteOfDayKst: -5 }).baseMinuteOfDayKst).toBe(0)
    expect(normalizeCollectionSchedule({ baseMinuteOfDayKst: 5_000 }).baseMinuteOfDayKst).toBe(1_439)
  })
})
