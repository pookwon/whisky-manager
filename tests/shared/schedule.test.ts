import { describe, expect, it } from 'vitest'
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
 * window through the clock, and the day boundary through `nextDaySettle`, which
 * lands after midnight. The operator's machine keeps KST, so the two agree — and
 * a test clock that did not would be testing a machine nobody runs.
 */
function kst(day: number, hour: number, minute = 0): number {
  return Date.UTC(2026, 7, day, hour, minute) - KST_OFFSET_MS
}

function clockAt(epochMs: number): FakeClock {
  return new FakeClock(epochMs, KST_OFFSET_MS)
}

// 2026-08-24 is a Monday.
const MON_10_00 = kst(24, 10)
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
    const drawn = limits.sessionIntervalMinMs
    const clock = clockAt(MON_10_00)
    const random = new SequenceRandom([drawn])
    expect(nextSessionStart(MON_10_00, limits, clock, random).at).toBe(MON_10_00 + drawn)
  })

  it('stretches the interval by the weekend multiplier on Saturday', () => {
    const drawn = limits.sessionIntervalMinMs
    const clock = clockAt(SAT_10_00)
    const random = new SequenceRandom([drawn])
    expect(nextSessionStart(SAT_10_00, limits, clock, random).at).toBe(
      SAT_10_00 + drawn * limits.weekendIntervalMultiplier,
    )
  })

  it('defers to the next operating window when the interval lands outside it', () => {
    // Just past the closing run, so the day it would settle is already spoken
    // for and the draw has nowhere to go but tomorrow morning. Two draws: the
    // interval, then how far into the window the opening session lands.
    const at = kst(25, 0, 30)
    const random = new SequenceRandom([HOUR, 5 * 60_000])
    expect(nextSessionStart(at, limits, clockAt(at), random).at).toBe(kst(25, 10, 5))
  })

  it('never opens the day on the instant the window opens', () => {
    // The boundary has no margin. The gate reads the clock again when the
    // session runs, and a read a hair early refuses a session the schedule
    // itself aimed at the opening — at the price of the whole interval to the
    // next one.
    const at = kst(25, 0, 30)
    const boundary = nextActiveStart(kst(25, 4), limits, clockAt(at))
    for (const jitter of [0, 1, 30_000, 60_000, 9 * 60_000, HOUR]) {
      const random = new SequenceRandom([HOUR, jitter])
      expect(nextSessionStart(at, limits, clockAt(at), random).at).toBeGreaterThan(boundary)
    }
  })

  it('keeps the opening session inside the window it waited for', () => {
    const at = kst(25, 0, 30)
    for (const jitter of [0, 60_000, 9 * 60_000, HOUR]) {
      const random = new SequenceRandom([HOUR, jitter])
      const next = nextSessionStart(at, limits, clockAt(at), random)
      expect(isWithinActiveHours(next.at, limits, clockAt(next.at))).toBe(true)
      // Late enough to have margin, early enough that the morning is not spent
      // waiting for it.
      expect(next.at - nextActiveStart(kst(25, 4), limits, clockAt(at))).toBeLessThanOrEqual(15 * 60_000)
    }
  })

  it('leaves a draw inside the day alone', () => {
    const random = new SequenceRandom([limits.sessionIntervalMinMs])
    const next = nextSessionStart(MON_10_00, limits, clockAt(MON_10_00), random)
    expect(next.mode).toBe('SCHEDULED')
    expect(next.at).toBe(MON_10_00 + limits.sessionIntervalMinMs)
  })
})

describe('nextSessionStart and the settle run', () => {
  it('settles the day at the boundary rather than waiting for the morning', () => {
    // 23:30. The next normal session is tomorrow morning; the run that settles
    // today comes first, a few minutes after midnight.
    const random = new SequenceRandom([HOUR, 5 * 60_000, 5 * 60_000])
    const next = nextSessionStart(MON_23_30, limits, clockAt(MON_23_30), random)
    expect(next.mode).toBe('SETTLE')
    expect(next.at).toBe(kst(25, 0, 5))
  })

  it('leaves a draw inside the day alone', () => {
    const random = new SequenceRandom([limits.sessionIntervalMinMs])
    const next = nextSessionStart(MON_10_00, limits, clockAt(MON_10_00), random)
    expect(next.mode).toBe('SCHEDULED')
    expect(next.at).toBe(MON_10_00 + limits.sessionIntervalMinMs)
  })

  it('does not draw a session that would outlast the day any differently', () => {
    // The old clamp pulled this back to just before midnight so the closing run
    // could still fit. It no longer has to fit: the settle run is after the day
    // ends, and a long session simply delays it.
    const at = kst(24, 22)
    const random = new SequenceRandom([4 * HOUR, 5 * 60_000, 5 * 60_000])
    const next = nextSessionStart(at, limits, clockAt(at), random)
    expect(next.mode).toBe('SETTLE')
    expect(next.at).toBe(kst(25, 0, 5))
  })

  it('goes back to normal sessions once the day is settled', () => {
    // Just after the settle run finished. The next boundary is a whole day
    // away, so the morning session is what comes next.
    const at = kst(25, 0, 20)
    const random = new SequenceRandom([HOUR, 4 * 60_000, 5 * 60_000])
    const next = nextSessionStart(at, limits, clockAt(at), random)
    expect(next.mode).toBe('SCHEDULED')
    expect(next.at).toBe(kst(25, 10, 4))
  })

  it('keeps settle runs distinct and repeats them across a long walk including weekends', () => {
    // Over 30 iterations spanning ~9 calendar days, the scheduler produces distinct
    // settle runs — no day is settled twice. However, not every calendar day receives
    // a settle run from the scheduler. Some days pass without one if a session is
    // still running when the settle moment (00:01–00:15 KST) passes, causing
    // nextSessionStart to move the boundary to the following day.
    //
    // The guarantee that every day eventually gets settled does not belong to the
    // scheduler: it lives in the session's owed-day check in src/desktop/orchestrator.ts.
    // That check runs before the session starts and settles any day the scheduler
    // did not, keeping the two mechanisms in sync.
    const SESSION_MS = 55 * 60_000
    const drawn = (limits.sessionIntervalMinMs + limits.sessionIntervalMaxMs) / 2
    const dayOf = (epochMs: number): number => kstDayRange(epochMs).startMs

    // Minimum settle runs observed over 30 iterations spanning ~9 days.
    // This is the floor we've measured; the scheduler does not guarantee one per day.
    const MIN_SETTLE_RUNS = 5

    const settled: number[] = []
    const reached = new Set<number>()
    let previousEnd = MON_10_00
    for (let i = 0; i < 30; i += 1) {
      const next = nextSessionStart(
        previousEnd,
        limits,
        clockAt(previousEnd),
        new SequenceRandom([drawn, 5 * 60_000, 5 * 60_000]),
      )
      reached.add(dayOf(next.at))
      // A settle run belongs to the day before the one it lands in.
      if (next.mode === 'SETTLE') settled.push(dayOf(next.at) - 86_400_000)
      previousEnd = next.at + SESSION_MS
    }

    // No day is settled twice by the scheduler (uniqueness check).
    expect(new Set(settled).size).toBe(settled.length)
    // Settle runs keep being drawn over the long walk.
    expect(settled.length).toBeGreaterThanOrEqual(MIN_SETTLE_RUNS)
    // The walk reaches across multiple days including at least a weekend.
    expect(reached.size).toBeGreaterThan(7)
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
