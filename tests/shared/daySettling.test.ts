import { describe, expect, it } from 'vitest'
import { nextDaySettle } from '../../src/shared/daySettling.js'
import { kstDayRange } from '../../src/shared/kst.js'
import type { Random } from '../../src/shared/ports.js'
import { SequenceRandom } from '../fakes.js'

const MINUTE = 60_000
const DAY = 86_400_000

// The KST day 2026-08-24 runs from 2026-08-23 15:00 UTC to 2026-08-24 15:00 UTC.
const DAY_START = Date.UTC(2026, 7, 23, 15, 0)
const DAY_END = Date.UTC(2026, 7, 24, 15, 0)
const MORNING = Date.UTC(2026, 7, 24, 1, 0) // 10:00 KST

function spread(ms: number): SequenceRandom {
  return new SequenceRandom([ms])
}

describe('nextDaySettle', () => {
  it('lands after the KST day it settles has ended', () => {
    // The whole point: a finished day cannot gain another post, so a run that
    // opens after midnight has no tail left to miss.
    const at = nextDaySettle(MORNING, spread(5 * MINUTE))
    expect(at).toBe(DAY_END + 5 * MINUTE)
    expect(at).toBeGreaterThan(DAY_END)
  })

  it('draws the offset from the band rather than landing on the same second', () => {
    expect(nextDaySettle(MORNING, spread(MINUTE))).toBe(DAY_END + MINUTE)
    expect(nextDaySettle(MORNING, spread(15 * MINUTE))).toBe(DAY_END + 15 * MINUTE)
  })

  it('asks for a one-to-fifteen-minute band', () => {
    // The bounds themselves, read off the request rather than the answer.
    // Asserting a clamped result would prove nothing: the fake clamps to the
    // band it is handed, so a wrong band would still come back looking right.
    const asked: [number, number][] = []
    const recording: Random = {
      intInclusive: (min, max) => {
        asked.push([min, max])
        return min
      },
    }

    nextDaySettle(MORNING, recording)

    expect(asked).toEqual([[MINUTE, 15 * MINUTE]])
  })

  it('draws the offset once, not once per branch', () => {
    // Two draws would let the answer depend on which side of the boundary the
    // call landed on, which is a difference nobody asked for.
    let draws = 0
    const counting: Random = {
      intInclusive: (min) => {
        draws += 1
        return min
      },
    }

    nextDaySettle(MORNING, counting)

    expect(draws).toBe(1)
  })

  it('still settles yesterday when the day has only just turned', () => {
    // 00:03 KST, and the run drawn for 00:05 has not fired yet. What is owed is
    // still yesterday, not the day that is three minutes old.
    const justAfterMidnight = DAY_START + 3 * MINUTE
    expect(nextDaySettle(justAfterMidnight, spread(5 * MINUTE))).toBe(DAY_START + 5 * MINUTE)
  })

  it('moves to the next boundary once the settle moment has passed', () => {
    const justAfterSettle = DAY_START + 6 * MINUTE
    expect(nextDaySettle(justAfterSettle, spread(5 * MINUTE))).toBe(DAY_END + 5 * MINUTE)
  })

  it('does not hand back the instant it just ran', () => {
    // Strictly after: the loop asks again the moment a session ends, and an
    // answer equal to now would schedule the run on top of itself.
    const settle = DAY_START + 5 * MINUTE
    expect(nextDaySettle(settle, spread(5 * MINUTE))).toBe(DAY_END + 5 * MINUTE)
  })

  it('reads the boundary in KST rather than the machine calendar', () => {
    // 2026-08-24 16:00 UTC is already 2026-08-25 in KST.
    const at = Date.UTC(2026, 7, 24, 16, 0)
    expect(nextDaySettle(at, spread(5 * MINUTE))).toBe(DAY_END + DAY + 5 * MINUTE)
  })

  it('always lands inside the day after the one it settles', () => {
    for (const drawn of [MINUTE, 5 * MINUTE, 15 * MINUTE]) {
      const at = nextDaySettle(MORNING, spread(drawn))
      const day = kstDayRange(at)
      expect(day.startMs).toBe(DAY_END)
    }
  })
})
