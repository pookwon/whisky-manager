import { describe, expect, it } from 'vitest'
import {
  collectionCoveragePercent,
  collectionRangeLabel,
  formatKstDateTime,
} from '../../src/renderer/format.js'

const HOUR = 3_600_000
const DAY = 86_400_000

describe('collection status formatting', () => {
  it('reads a span on the cafe clock, not the machine one', () => {
    // 2026-08-28T09:30:10Z is 18:30 on 08-28 in KST; the machine's zone must
    // not be able to move it to another day.
    expect(formatKstDateTime(Date.UTC(2026, 7, 28, 9, 30, 10))).toBe('08-28 18:30')
    expect(formatKstDateTime(Date.UTC(2026, 7, 28, 15, 0, 0))).toBe('08-29 00:00')
  })

  it('names a range in the unit it was asked in', () => {
    const end = Date.UTC(2026, 7, 31)
    expect(collectionRangeLabel({ targetStartMs: end - 3 * DAY, targetEndMs: end })).toBe('최근 3일')
    expect(collectionRangeLabel({ targetStartMs: end - DAY, targetEndMs: end })).toBe('최근 1일')
    expect(collectionRangeLabel({ targetStartMs: end - 3 * HOUR, targetEndMs: end })).toBe('최근 3시간')
    // Under an hour is still an hour to read, never '최근 0시간'.
    expect(collectionRangeLabel({ targetStartMs: end - 60_000, targetEndMs: end })).toBe('최근 1시간')
  })

  it('measures progress by how far back the cursor has walked, not by pages', () => {
    const end = Date.UTC(2026, 7, 31)
    const range = { targetStartMs: end - 3 * DAY, targetEndMs: end }

    expect(collectionCoveragePercent({ ...range, cursorPostedAtMs: end })).toBe(0)
    expect(collectionCoveragePercent({ ...range, cursorPostedAtMs: end - 1.5 * DAY })).toBe(50)
    expect(collectionCoveragePercent({ ...range, cursorPostedAtMs: range.targetStartMs })).toBe(100)
    // A post older than the range was still asked for; it cannot exceed 100.
    expect(collectionCoveragePercent({ ...range, cursorPostedAtMs: range.targetStartMs - DAY })).toBe(100)
  })

  it('has no progress to report before the first page is committed', () => {
    const end = Date.UTC(2026, 7, 31)
    // Null, not zero: nothing stored yet is a different state from a run that
    // has walked nowhere, and the bar must not claim the second.
    expect(
      collectionCoveragePercent({ targetStartMs: end - DAY, targetEndMs: end, cursorPostedAtMs: null }),
    ).toBeNull()
  })
})
