import { describe, expect, it } from 'vitest'
import { PROFILES } from '../../src/shared/profiles.js'
import {
  isWithinActiveHours,
  nextActionDelayMs,
  nextActiveStart,
  nextSessionStart,
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
    const clock = new FakeClock(MON_10_00)
    const random = new SequenceRandom([50 * 60_000])
    expect(nextSessionStart(MON_10_00, limits, clock, random)).toBe(MON_10_00 + 50 * 60_000)
  })

  it('stretches the interval by the weekend multiplier on Saturday', () => {
    const clock = new FakeClock(SAT_10_00)
    const random = new SequenceRandom([60 * 60_000])
    expect(nextSessionStart(SAT_10_00, limits, clock, random)).toBe(SAT_10_00 + 90 * 60_000)
  })

  it('defers to the next operating window when the interval lands outside it', () => {
    const clock = new FakeClock(MON_23_30)
    const random = new SequenceRandom([60 * 60_000])
    expect(nextSessionStart(MON_23_30, limits, clock, random)).toBe(Date.UTC(2026, 7, 25, 8, 0, 0))
  })
})

describe('nextActionDelayMs', () => {
  it('draws from the action interval range', () => {
    expect(nextActionDelayMs(limits, new SequenceRandom([12_000]))).toBe(12_000)
  })
})
