import { kstDayRange } from './kst.js'

/**
 * How far ahead of midnight the closing run lands. A minute: close enough to
 * the boundary that whatever the day brought has arrived, far enough inside it
 * that the run still belongs to the day it settles rather than the next one.
 */
const CLOSING_LEAD_MS = 60_000

/**
 * The next run that settles a day, strictly after `afterMs`.
 *
 * The day here is the KST one, the same day collection draws its floor from
 * (`kstDayRange`). Reading the boundary off the machine's calendar instead
 * would let the sweep fire on one side of midnight while the floor moves on the
 * other, and a run that closes a day it is no longer collecting closes nothing.
 *
 * Strictly after, because the loop asks again once a session ends: handed back
 * the instant it just ran, a closing run would schedule itself on top of
 * itself.
 */
export function nextDayClosing(afterMs: number): number {
  const { endMs } = kstDayRange(afterMs)
  const closing = endMs - CLOSING_LEAD_MS
  return closing > afterMs ? closing : kstDayRange(endMs).endMs - CLOSING_LEAD_MS
}
