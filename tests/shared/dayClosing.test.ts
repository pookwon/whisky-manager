import { describe, expect, it } from 'vitest'
import { nextDayClosing } from '../../src/shared/dayClosing.js'
import { kstDayRange } from '../../src/shared/kst.js'

const MINUTE = 60_000
const DAY = 86_400_000

// The KST day 2026-08-24 runs from 2026-08-23 15:00 UTC to 2026-08-24 15:00 UTC.
const DAY_END = Date.UTC(2026, 7, 24, 15, 0)
const CLOSING = Date.UTC(2026, 7, 24, 14, 59)
const MORNING = Date.UTC(2026, 7, 24, 1, 0) // 10:00 KST

describe('nextDayClosing', () => {
  it('lands a minute before the KST day ends', () => {
    expect(nextDayClosing(MORNING)).toBe(CLOSING)
    expect(DAY_END - nextDayClosing(MORNING)).toBe(MINUTE)
  })

  it('closes the day that has only just begun', () => {
    expect(nextDayClosing(kstDayRange(MORNING).startMs)).toBe(CLOSING)
  })

  it('still belongs to the day it settles', () => {
    const day = kstDayRange(MORNING)
    const closing = nextDayClosing(MORNING)
    expect(closing).toBeGreaterThan(day.startMs)
    expect(closing).toBeLessThan(day.endMs)
  })

  it('moves to the next day once the closing moment arrives', () => {
    // Strictly after: a session that just closed the day must not be handed
    // the same instant again, or the loop would fire twice on one boundary.
    expect(nextDayClosing(CLOSING)).toBe(CLOSING + DAY)
  })

  it('moves to the next day when the closing moment has passed', () => {
    expect(nextDayClosing(CLOSING + MINUTE)).toBe(CLOSING + DAY)
  })

  it('reads the boundary in KST rather than the machine calendar', () => {
    // 2026-08-24 16:00 UTC is already 2026-08-25 in KST, so the closing run
    // due next is that day's, not the one the UTC date would suggest.
    expect(nextDayClosing(Date.UTC(2026, 7, 24, 16, 0))).toBe(CLOSING + DAY)
  })
})
