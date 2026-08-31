import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLLECTION_SCHEDULE,
  checkCollectionRange,
  collectionRangeOfDays,
  nextCollectionRunTime,
  normalizeCollectionSchedule,
  pagesPerWorkBlock,
} from '../../src/shared/collectionSchedule.js'

const DAY = 86_400_000
const HOUR = 3_600_000
/** 2026-08-31 00:00 UTC = 09:00 KST. */
const NOW = Date.UTC(2026, 7, 31, 0, 0)
const kst = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 16).replace('T', ' ')

const enabled = { ...DEFAULT_COLLECTION_SCHEDULE, enabled: true }

describe('collection schedule', () => {
  it('schedules nothing when disabled', () => {
    expect(nextCollectionRunTime(NOW, { ...enabled, enabled: false })).toBeNull()
  })

  it('returns the start of the active window when now is before it', () => {
    // NOW is 09:00 KST. Go back 1 hour to get 08:00 KST.
    const timeAt8am = NOW - 1 * HOUR // 2026-08-31 08:00 KST
    const result = nextCollectionRunTime(timeAt8am, enabled)
    expect(kst(result ?? 0)).toBe('2026-08-31 09:00')
  })

  it('returns now when inside the active window', () => {
    // At 10:00 KST, we are inside the 09:00–21:00 window
    const timeAt10am = NOW + 1 * HOUR // 10:00 KST
    const result = nextCollectionRunTime(timeAt10am, enabled)
    expect(result).toBe(timeAt10am)
  })

  it('jumps to tomorrow when past todays window', () => {
    // At 22:00 KST, window ends at 21:00, so jump to tomorrow 09:00
    const timeAt10pm = NOW + 13 * HOUR // 22:00 KST
    const result = nextCollectionRunTime(timeAt10pm, enabled)
    expect(kst(result ?? 0)).toBe('2026-09-01 09:00')
  })

  it('clamps to the window start after a rest period', () => {
    // Last run ended at 21:00 KST, rest is 120 minutes → 23:00 KST
    // That is past today's window, so it jumps to tomorrow 09:00
    const lastRunEnd = NOW + 12 * HOUR // 21:00 KST
    const result = nextCollectionRunTime(NOW, enabled, lastRunEnd)
    expect(kst(result ?? 0)).toBe('2026-09-01 09:00')
  })

  it('returns next run within the window if rest period fits', () => {
    // NOW is 09:00 KST. Last run ended at 18:00 KST (9 hours before NOW... wait that's wrong)
    // Let me recalculate: NOW + 9*HOUR = 18:00 KST
    // 18:00 + 120 min rest = 20:00, still in 09:00-21:00 window
    const lastRunEnd = NOW + 9 * HOUR // 18:00 KST
    const result = nextCollectionRunTime(NOW, enabled, lastRunEnd)
    expect(kst(result ?? 0)).toBe('2026-08-31 20:00')
  })

  it('estimates pages per work block conservatively', () => {
    // 120 minutes should fit ~299 requests with pacing
    const pages = pagesPerWorkBlock(120)
    expect(pages).toBeGreaterThan(200)
    expect(pages).toBeLessThan(350)
  })

  it('scales pages down with smaller work blocks', () => {
    const pages30 = pagesPerWorkBlock(30)
    const pages120 = pagesPerWorkBlock(120)
    expect(pages30).toBeLessThan(pages120)
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
  })

  it('brings anything stored back into a shape the loop can run', () => {
    // Whatever a hand-edited settings row holds, the loop gets a usable value.
    expect(normalizeCollectionSchedule({ workBlockMinutes: -100, restMinutes: 5_000 })).toEqual({
      enabled: false,
      activeWindowStartHourKst: 9,
      activeWindowEndHourKst: 21,
      workBlockMinutes: 30,
      restMinutes: 480,
    })
    expect(normalizeCollectionSchedule({ activeWindowStartHourKst: -5 }).activeWindowStartHourKst).toBe(0)
    expect(normalizeCollectionSchedule({ activeWindowEndHourKst: 25 }).activeWindowEndHourKst).toBe(23)
  })
})
