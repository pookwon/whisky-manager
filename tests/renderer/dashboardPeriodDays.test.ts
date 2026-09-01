import { describe, expect, it } from 'vitest'
import {
  periodDays,
  remainingFromMs,
  remainingToMs,
} from '../../src/renderer/views/dashboard/periodDays.js'

function kst(iso: string): number {
  return Date.parse(`${iso}+09:00`)
}

/** August 2026, the way the app stores it: the end is the midnight after. */
const AUGUST = {
  targetStartMs: kst('2026-08-01T00:00:00'),
  targetEndMs: kst('2026-09-01T00:00:00'),
}

describe('periodDays', () => {
  it('gives one cell per whole day of the period', () => {
    const days = periodDays({ ...AUGUST, cursorPostedAtMs: null })

    expect(days).toHaveLength(31)
    expect(days[0]?.startMs).toBe(kst('2026-08-01T00:00:00'))
    // The last cell is the 31st, not the midnight the period ends at — that
    // instant belongs to September and is not part of the job.
    expect(days[30]?.startMs).toBe(kst('2026-08-31T00:00:00'))
  })

  it('leaves every day remaining before the first page lands', () => {
    const days = periodDays({ ...AUGUST, cursorPostedAtMs: null })

    expect(days.every((day) => day.state === 'remaining')).toBe(true)
  })

  it('marks the days newer than the cursor stored and the older ones remaining', () => {
    // The walk runs newest to oldest, so a cursor on the 13th means the 14th
    // through the 31st are behind it and the 1st through the 12th are not.
    const days = periodDays({ ...AUGUST, cursorPostedAtMs: kst('2026-08-13T04:12:00') })
    const state = (day: number): string | undefined => days[day - 1]?.state

    expect(state(31)).toBe('stored')
    expect(state(14)).toBe('stored')
    expect(state(13)).toBe('walking')
    expect(state(12)).toBe('remaining')
    expect(state(1)).toBe('remaining')
  })

  it('counts the cursor day as one still being read', () => {
    const days = periodDays({ ...AUGUST, cursorPostedAtMs: kst('2026-08-13T23:59:00') })

    // Late in the day and still 'walking': the walk has passed everything after
    // 23:59 on the 13th, but the rest of that day is unread.
    expect(days.filter((day) => day.state === 'walking')).toHaveLength(1)
    expect(days[12]?.state).toBe('walking')
  })

  it('answers with no cells for an inverted period rather than throwing', () => {
    // A job is data read back from storage, and a screen that crashes on a bad
    // row is worse than one that draws nothing.
    expect(
      periodDays({
        targetStartMs: kst('2026-08-31T00:00:00'),
        targetEndMs: kst('2026-08-01T00:00:00'),
        cursorPostedAtMs: null,
      }),
    ).toEqual([])
  })

  it('draws a single-day period as one cell', () => {
    const days = periodDays({
      targetStartMs: kst('2026-08-27T00:00:00'),
      targetEndMs: kst('2026-08-28T00:00:00'),
      cursorPostedAtMs: null,
    })

    expect(days).toHaveLength(1)
  })
})

describe('the stretch still to be walked', () => {
  it('runs from the period start to the day the cursor stands in', () => {
    const job = { ...AUGUST, cursorPostedAtMs: kst('2026-08-13T04:12:00') }

    expect(remainingFromMs(job)).toBe(kst('2026-08-01T00:00:00'))
    expect(remainingToMs(job)).toBe(kst('2026-08-13T00:00:00'))
  })

  it('is the whole period before the first page lands', () => {
    const job = { ...AUGUST, cursorPostedAtMs: null }

    expect(remainingFromMs(job)).toBe(kst('2026-08-01T00:00:00'))
    expect(remainingToMs(job)).toBe(kst('2026-08-31T00:00:00'))
  })
})
