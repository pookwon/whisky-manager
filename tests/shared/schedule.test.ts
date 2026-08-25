import { describe, expect, it } from 'vitest'
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
// 2026-08-24 is a Monday.
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)
const MON_23_30 = Date.UTC(2026, 7, 24, 23, 30, 0)
const MON_03_00 = Date.UTC(2026, 7, 24, 3, 0, 0)
const SAT_10_00 = Date.UTC(2026, 7, 29, 10, 0, 0)

describe('isWithinActiveHours', () => {
  it('accepts a time inside the operating window', () => {
    expect(isWithinActiveHours(MON_10_00, limits, new FakeClock(MON_10_00))).toBe(true)
  })

  it('rejects a time before the window opens', () => {
    expect(isWithinActiveHours(MON_03_00, limits, new FakeClock(MON_03_00))).toBe(false)
  })

  it('accepts the exact opening hour', () => {
    const at8 = Date.UTC(2026, 7, 24, 8, 0, 0)
    expect(isWithinActiveHours(at8, limits, new FakeClock(at8))).toBe(true)
  })
})

describe('nextActiveStart', () => {
  it('returns today 08:00 when the window has not opened yet', () => {
    expect(nextActiveStart(MON_03_00, limits, new FakeClock(MON_03_00))).toBe(Date.UTC(2026, 7, 24, 8, 0, 0))
  })

  it('returns tomorrow 08:00 when the window has already closed', () => {
    const after = Date.UTC(2026, 7, 25, 1, 0, 0)
    expect(nextActiveStart(after, limits, new FakeClock(after))).toBe(Date.UTC(2026, 7, 25, 8, 0, 0))
  })
})

describe('nextSessionStart', () => {
  it('adds a jittered interval inside the configured range', () => {
    // Drawn from the profile's own band: a literal outside it would be clamped
    // and the assertion would then be about the clamp, not the jitter.
    const drawn = limits.sessionIntervalMinMs
    const clock = new FakeClock(MON_10_00)
    const random = new SequenceRandom([drawn])
    expect(nextSessionStart(MON_10_00, limits, clock, random)).toBe(MON_10_00 + drawn)
  })

  it('stretches the interval by the weekend multiplier on Saturday', () => {
    const drawn = limits.sessionIntervalMinMs
    const clock = new FakeClock(SAT_10_00)
    const random = new SequenceRandom([drawn])
    expect(nextSessionStart(SAT_10_00, limits, clock, random)).toBe(
      SAT_10_00 + drawn * limits.weekendIntervalMultiplier,
    )
  })

  it('defers to the next operating window when the interval lands outside it', () => {
    const clock = new FakeClock(MON_23_30)
    const random = new SequenceRandom([60 * 60_000])
    expect(nextSessionStart(MON_23_30, limits, clock, random)).toBe(Date.UTC(2026, 7, 25, 8, 0, 0))
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
