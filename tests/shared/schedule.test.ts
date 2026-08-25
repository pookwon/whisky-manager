import { describe, expect, it } from 'vitest'
import { nextDayClosing } from '../../src/shared/dayClosing.js'
import { KST_OFFSET_MS, kstDayRange } from '../../src/shared/kst.js'
import { PROFILES } from '../../src/shared/profiles.js'
import {
  isWithinActiveHours,
  nextActionDelayMs,
  nextActiveStart,
  nextCommentLookupDelayMs,
  nextPageFetchDelayMs,
  nextSessionStart,
  nextWarmDelayMs,
} from '../../src/shared/schedule.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

const limits = PROFILES.production
const HOUR = 3_600_000

/**
 * Every time here is KST, on both calendars the scheduler reads: the operating
 * window through the clock, and the day boundary through `nextDayClosing`. The
 * operator's machine keeps KST, so the two agree — and a test clock that did
 * not would be testing a machine nobody runs.
 */
function kst(day: number, hour: number, minute = 0): number {
  return Date.UTC(2026, 7, day, hour, minute) - KST_OFFSET_MS
}

function clockAt(epochMs: number): FakeClock {
  return new FakeClock(epochMs, KST_OFFSET_MS)
}

// 2026-08-24 is a Monday.
const MON_10_00 = kst(24, 10)
const MON_22_00 = kst(24, 22)
const MON_23_30 = kst(24, 23, 30)
const MON_03_00 = kst(24, 3)
const SAT_10_00 = kst(29, 10)

describe('isWithinActiveHours', () => {
  it('accepts a time inside the operating window', () => {
    expect(isWithinActiveHours(MON_10_00, limits, clockAt(MON_10_00))).toBe(true)
  })

  it('rejects a time before the window opens', () => {
    expect(isWithinActiveHours(MON_03_00, limits, clockAt(MON_03_00))).toBe(false)
  })

  it('accepts the exact opening hour', () => {
    const at10 = kst(24, 10)
    expect(isWithinActiveHours(at10, limits, clockAt(at10))).toBe(true)
  })

  it('rejects the hour before the window opens', () => {
    const at9 = kst(24, 9)
    expect(isWithinActiveHours(at9, limits, clockAt(at9))).toBe(false)
  })
})

describe('nextActiveStart', () => {
  it('returns today 10:00 when the window has not opened yet', () => {
    expect(nextActiveStart(MON_03_00, limits, clockAt(MON_03_00))).toBe(kst(24, 10))
  })

  it('returns tomorrow 10:00 when the window has already closed', () => {
    const after = kst(25, 1)
    expect(nextActiveStart(after, limits, clockAt(after))).toBe(kst(25, 10))
  })
})

describe('nextSessionStart', () => {
  it('adds a jittered interval inside the configured range', () => {
    // Drawn from the profile's own band: a literal outside it would be clamped
    // and the assertion would then be about the clamp, not the jitter.
    const drawn = limits.sessionIntervalMinMs
    const clock = clockAt(MON_10_00)
    const random = new SequenceRandom([drawn])
    expect(nextSessionStart(MON_10_00, limits, clock, random)).toBe(MON_10_00 + drawn)
  })

  it('stretches the interval by the weekend multiplier on Saturday', () => {
    const drawn = limits.sessionIntervalMinMs
    const clock = clockAt(SAT_10_00)
    const random = new SequenceRandom([drawn])
    expect(nextSessionStart(SAT_10_00, limits, clock, random)).toBe(
      SAT_10_00 + drawn * limits.weekendIntervalMultiplier,
    )
  })

  it('defers to the next operating window when the interval lands outside it', () => {
    // Just past the closing run, so the day it would settle is already spoken
    // for and the draw has nowhere to go but tomorrow morning.
    const at = kst(25, 0, 30)
    const random = new SequenceRandom([HOUR])
    expect(nextSessionStart(at, limits, clockAt(at), random)).toBe(kst(25, 10))
  })

  it('closes the day rather than deferring past it', () => {
    // Half an hour of the day is left. Tomorrow's window is further away than
    // the run that settles today, so today's is what comes next.
    const random = new SequenceRandom([HOUR])
    expect(nextSessionStart(MON_23_30, limits, clockAt(MON_23_30), random)).toBe(
      nextDayClosing(MON_23_30),
    )
  })

  it('closes the day when the drawn interval would carry the session past it', () => {
    // 22:00, and four hours from here is tomorrow's business. Left alone the
    // day would roll over with its last arrivals unanswered.
    const random = new SequenceRandom([4 * HOUR])
    expect(nextSessionStart(MON_22_00, limits, clockAt(MON_22_00), random)).toBe(
      nextDayClosing(MON_22_00),
    )
  })

  it('gives way to the closing run rather than start a session it would outlast', () => {
    // The draw lands inside the operating window and before the closing run,
    // and is still refused: a session starting here is still working when the
    // day ends, and the loop asks for the next one only once it stops.
    const at = kst(24, 20)
    const random = new SequenceRandom([3 * HOUR + 30 * 60_000])
    const drawn = at + 3 * HOUR + 30 * 60_000
    expect(drawn).toBeLessThan(nextDayClosing(at))
    expect(nextSessionStart(at, limits, clockAt(at), random)).toBe(nextDayClosing(at))
  })

  it('leaves a draw that finishes inside the day alone', () => {
    const random = new SequenceRandom([limits.sessionIntervalMinMs])
    expect(nextSessionStart(MON_10_00, limits, clockAt(MON_10_00), random)).toBe(
      MON_10_00 + limits.sessionIntervalMinMs,
    )
  })

  it('gives every day exactly one closing run, weekends included', () => {
    // The guarantee itself, run out over a week rather than asserted a case at
    // a time: whatever the draws and the weekend stretch do in between, each
    // day ends with the run that settles it, and ends with only one.
    const SESSION_MS = 55 * 60_000
    const drawn = (limits.sessionIntervalMinMs + limits.sessionIntervalMaxMs) / 2
    const dayOf = (epochMs: number): number => kstDayRange(epochMs).startMs

    const starts: number[] = []
    let previousEnd = MON_10_00
    for (let i = 0; i < 30; i += 1) {
      const at = nextSessionStart(previousEnd, limits, clockAt(previousEnd), new SequenceRandom([drawn]))
      starts.push(at)
      previousEnd = at + SESSION_MS
    }

    // A session is the closing one when it sits on the moment its own day closes.
    const closedDays = starts.filter((at) => at === nextDayClosing(at - 1)).map(dayOf)
    const daysReached = [...new Set(starts.map(dayOf))]

    // Every day but the last, which the loop leaves still in progress.
    expect(closedDays).toEqual(daysReached.slice(0, -1))
    expect(daysReached.length).toBeGreaterThan(7)
  })

  it('does not repeat a closing run it has just finished', () => {
    // Handed back the instant it just ran, the schedule has to look past it:
    // repeating it would fire the same boundary twice.
    const closing = nextDayClosing(MON_22_00)
    const random = new SequenceRandom([limits.sessionIntervalMinMs])
    expect(nextSessionStart(closing, limits, clockAt(closing), random)).toBe(kst(25, 10))
  })
})

describe('nextActionDelayMs', () => {
  it('draws from the action interval range', () => {
    const drawn = limits.actionIntervalMinMs + 1_000
    expect(nextActionDelayMs(limits, new SequenceRandom([drawn]))).toBe(drawn)
  })
})

describe('nextPageFetchDelayMs', () => {
  it('returns the lower bound when random returns its minimum', () => {
    // SequenceRandom clamps to [min, max], so passing 0 means it uses 0
    // which maps to 1750ms in the range [1750, 2500]
    const delay = nextPageFetchDelayMs(new SequenceRandom([0]))
    expect(delay).toBe(1_750)
  })

  it('returns the upper bound when random returns its maximum', () => {
    // Passing a high value should clamp to the max
    const delay = nextPageFetchDelayMs(new SequenceRandom([10_000]))
    expect(delay).toBe(2_500)
  })

  it('returns a value in the middle when random returns a midpoint', () => {
    const delay = nextPageFetchDelayMs(new SequenceRandom([2_125]))
    expect(delay).toBeGreaterThanOrEqual(1_750)
    expect(delay).toBeLessThanOrEqual(2_500)
  })
})

describe('nextCommentLookupDelayMs', () => {
  it('returns the lower bound when random returns its minimum', () => {
    // SequenceRandom clamps to [min, max], so passing 0 means it uses 0
    // which maps to 1000ms in the range [1000, 1500]
    const delay = nextCommentLookupDelayMs(new SequenceRandom([0]))
    expect(delay).toBe(1_000)
  })

  it('returns the upper bound when random returns its maximum', () => {
    // Passing a high value should clamp to the max
    const delay = nextCommentLookupDelayMs(new SequenceRandom([10_000]))
    expect(delay).toBe(1_500)
  })

  it('returns a value in the middle when random returns a midpoint', () => {
    const delay = nextCommentLookupDelayMs(new SequenceRandom([1_250]))
    expect(delay).toBeGreaterThanOrEqual(1_000)
    expect(delay).toBeLessThanOrEqual(1_500)
  })
})

describe('nextWarmDelayMs', () => {
  it('returns the lower bound when random returns its minimum', () => {
    expect(nextWarmDelayMs(new SequenceRandom([0]))).toBe(50 * 60_000)
  })

  it('returns the upper bound when random returns its maximum', () => {
    expect(nextWarmDelayMs(new SequenceRandom([10 * 3_600_000]))).toBe(70 * 60_000)
  })

  it('draws around the hour rather than on it', () => {
    const delay = nextWarmDelayMs(new SequenceRandom([3_600_000]))
    expect(delay).toBeGreaterThanOrEqual(50 * 60_000)
    expect(delay).toBeLessThanOrEqual(70 * 60_000)
  })
})
