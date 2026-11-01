import { describe, expect, it } from 'vitest'
import { isMonthStartWindow, previousKstMonthRange } from '../../src/shared/monthStart.js'

const kst = (ms: number): string => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10)

describe('month start window', () => {
  it('covers the first three KST days', () => {
    expect(isMonthStartWindow(Date.UTC(2026, 9, 31, 15, 0))).toBe(true) // 11-01 00:00 KST
    expect(isMonthStartWindow(Date.UTC(2026, 10, 3, 14, 59))).toBe(true) // 11-03 23:59 KST
    expect(isMonthStartWindow(Date.UTC(2026, 10, 3, 15, 0))).toBe(false) // 11-04 00:00 KST
    expect(isMonthStartWindow(Date.UTC(2026, 9, 31, 14, 59))).toBe(false) // 10-31 23:59 KST
  })

  it('names the whole previous KST month', () => {
    const range = previousKstMonthRange(Date.UTC(2026, 10, 1, 1))
    expect(kst(range.startMs)).toBe('2026-10-01')
    expect(kst(range.endMs)).toBe('2026-11-01')
  })

  it('goes back across the year', () => {
    const range = previousKstMonthRange(Date.UTC(2027, 0, 2, 1))
    expect(kst(range.startMs)).toBe('2026-12-01')
    expect(kst(range.endMs)).toBe('2027-01-01')
  })
})
