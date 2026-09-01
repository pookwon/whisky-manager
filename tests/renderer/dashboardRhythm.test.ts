import { describe, expect, it } from 'vitest'
import {
  hourMarks,
  rhythmBand,
  rhythmPercent,
  rhythmSpan,
  runsOnDay,
  windowBand,
} from '../../src/renderer/views/dashboard/rhythm.js'

/** An instant written the way the operator reads it: on the cafe's clock. */
function kst(iso: string): number {
  return Date.parse(`${iso}+09:00`)
}

const COMMENT_WINDOW = { startHour: 8, endHour: 24 }
const COLLECTION_WINDOW = { startHour: 9, endHour: 21 }

describe('rhythmSpan', () => {
  it('holds every operating window whole, with an hour of air before the first', () => {
    const span = rhythmSpan(kst('2026-08-24T13:52:00'), [COMMENT_WINDOW, COLLECTION_WINDOW])

    expect(span.startHour).toBe(7)
    expect(span.endHour).toBe(24)
  })

  it('widens to hold now, so the cursor never sits on an edge that means an end', () => {
    // 02:10 is hours before either window opens. Drawn from 08:00 the cursor
    // would be pinned to the left edge, which reads as "the day just started".
    const span = rhythmSpan(kst('2026-08-24T02:10:00'), [COMMENT_WINDOW, COLLECTION_WINDOW])

    expect(span.startHour).toBe(1)
    expect(rhythmPercent(kst('2026-08-24T02:10:00'), span)).toBeGreaterThan(0)
  })

  it('never reaches past the day it is drawing', () => {
    const span = rhythmSpan(kst('2026-08-24T23:40:00'), [COMMENT_WINDOW])

    expect(span.endHour).toBe(24)
  })

  it('draws the KST day the instant belongs to, not the one the machine is set to', () => {
    // 00:30 KST is still the previous day in UTC; a span anchored on the wrong
    // midnight puts every one of today's blocks off the left edge.
    const span = rhythmSpan(kst('2026-08-24T00:30:00'), [COMMENT_WINDOW])

    expect(span.dayStartMs).toBe(kst('2026-08-24T00:00:00'))
  })
})

describe('rhythmPercent', () => {
  const span = rhythmSpan(kst('2026-08-24T13:52:00'), [COMMENT_WINDOW, COLLECTION_WINDOW])

  it('places an instant by how far into the drawn stretch it falls', () => {
    // 07:00 to 24:00 is seventeen hours; 13:52 is 6h52m into it.
    expect(rhythmPercent(kst('2026-08-24T13:52:00'), span)).toBeCloseTo(40.39, 1)
    expect(rhythmPercent(kst('2026-08-24T07:00:00'), span)).toBe(0)
    expect(rhythmPercent(kst('2026-08-25T00:00:00'), span)).toBe(100)
  })

  it('clamps anything earlier or later to the edge it ran off', () => {
    expect(rhythmPercent(kst('2026-08-23T22:00:00'), span)).toBe(0)
    expect(rhythmPercent(kst('2026-08-25T04:00:00'), span)).toBe(100)
  })
})

describe('rhythmBand', () => {
  const span = rhythmSpan(kst('2026-08-24T13:52:00'), [COMMENT_WINDOW, COLLECTION_WINDOW])

  it('measures a stretch from its own start', () => {
    const band = rhythmBand(kst('2026-08-24T09:05:00'), kst('2026-08-24T09:35:00'), span)

    expect(band).not.toBeNull()
    // Thirty minutes of a seventeen-hour stretch.
    expect(band?.widthPercent).toBeCloseTo(2.94, 1)
    expect(band?.leftPercent).toBeCloseTo(12.25, 1)
  })

  it('answers null for a stretch that is entirely off the drawing', () => {
    // A block from yesterday evening: clamped, both ends land on 0, and a
    // zero-width band would still paint its border as a mark at midnight.
    expect(rhythmBand(kst('2026-08-23T18:00:00'), kst('2026-08-23T18:30:00'), span)).toBeNull()
  })

  it('keeps the visible part of a stretch that starts before the drawing', () => {
    const band = rhythmBand(kst('2026-08-24T06:00:00'), kst('2026-08-24T08:00:00'), span)

    expect(band?.leftPercent).toBe(0)
    expect(band?.widthPercent).toBeCloseTo(5.88, 1)
  })
})

describe('windowBand', () => {
  it('draws an operating window as the stretch it is open for', () => {
    const span = rhythmSpan(kst('2026-08-24T13:52:00'), [COMMENT_WINDOW, COLLECTION_WINDOW])
    const band = windowBand(COLLECTION_WINDOW, span)

    // 09:00-21:00 is twelve of the seventeen drawn hours, starting two in.
    expect(band?.leftPercent).toBeCloseTo(11.76, 1)
    expect(band?.widthPercent).toBeCloseTo(70.59, 1)
  })
})

describe('hourMarks', () => {
  it('labels both ends of the drawn stretch and every third hour between', () => {
    const span = rhythmSpan(kst('2026-08-24T13:52:00'), [COMMENT_WINDOW, COLLECTION_WINDOW])

    expect(hourMarks(span).map((mark) => mark.hour)).toEqual([7, 9, 12, 15, 18, 21, 24])
  })

  it('never repeats an end that is already on the step', () => {
    const span = rhythmSpan(kst('2026-08-24T13:00:00'), [{ startHour: 10, endHour: 21 }])

    expect(hourMarks(span).map((mark) => mark.hour)).toEqual([9, 12, 15, 18, 21])
  })
})

describe('runsOnDay', () => {
  const span = rhythmSpan(kst('2026-08-24T13:52:00'), [COMMENT_WINDOW, COLLECTION_WINDOW])

  it('keeps the runs that started on the day being drawn', () => {
    const runs = [
      { startedAtMs: kst('2026-08-24T09:05:00'), finishedAtMs: kst('2026-08-24T09:35:00') },
      { startedAtMs: kst('2026-08-23T20:00:00'), finishedAtMs: kst('2026-08-23T20:30:00') },
      { startedAtMs: kst('2026-08-25T09:00:00'), finishedAtMs: null },
    ]

    expect(runsOnDay(runs, span)).toEqual([runs[0]])
  })

  it('places a run by when it started, not by when it ended', () => {
    // A block that crossed midnight belongs to the day it began on; drawing it
    // on today would put a block where nothing happened today.
    const overnight = [
      { startedAtMs: kst('2026-08-23T23:50:00'), finishedAtMs: kst('2026-08-24T00:20:00') },
    ]

    expect(runsOnDay(overnight, span)).toEqual([])
  })
})
