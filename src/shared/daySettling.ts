import { kstDayRange } from './kst.js'
import type { Random } from './ports.js'

/**
 * How far past midnight the run that settles a day lands.
 *
 * Past it, not before it. A run opened while the day is still running leaves
 * whatever arrives after its collection unanswered, and the next day floors at
 * its own midnight, so nothing looks at those posts again. A finished day
 * cannot gain another post, which is what makes the gap disappear rather than
 * merely narrow.
 *
 * A band rather than a fixed offset, for the reason every interval here is
 * drawn: a run landing on the same second of every night is the shape of a
 * machine. The floor is a minute — far enough inside the new day that a clock
 * nudged backwards between the schedule and the gate cannot land the run in the
 * day it means to settle.
 */
const SETTLE_SPREAD_MIN_MS = 60_000
const SETTLE_SPREAD_MAX_MS = 15 * 60_000

/**
 * The next run that settles a finished day, strictly after `afterMs`.
 *
 * The day is the KST one, the same day collection draws its floor from
 * (`kstDayRange`). Reading the boundary off the machine's calendar instead
 * would let the run fire on one side of midnight while the floor moves on the
 * other, and a run that settles a day it is not collecting settles nothing.
 *
 * Strictly after, because the loop asks again once a session ends: handed back
 * the instant it just ran, the run would schedule itself on top of itself.
 */
export function nextDaySettle(afterMs: number, random: Random): number {
  const spread = random.intInclusive(SETTLE_SPREAD_MIN_MS, SETTLE_SPREAD_MAX_MS)
  const { startMs, endMs } = kstDayRange(afterMs)

  // Yesterday's run, when the day has turned but the run has not fired yet.
  const owed = startMs + spread
  return owed > afterMs ? owed : endMs + spread
}
