import { kstDayStartMs } from '../../../shared/kst.js'

/**
 * The target period as one cell per day.
 *
 * How much is left is said in days because that is the unit the period was
 * asked for in, and because a page number points at different posts an hour
 * later. A row of days survives that: the cell for the 12th means the 12th
 * whatever the feed does underneath.
 */

const DAY_MS = 86_400_000

/** How far the walk has got through a given day. */
export type PeriodDayState =
  /** Walked past — everything in this day that was going to be stored is. */
  | 'stored'
  /** The day the cursor is standing in, so partly done. */
  | 'walking'
  /** Not reached yet. The walk runs newest to oldest, so these are the old end. */
  | 'remaining'

export interface PeriodDay {
  readonly startMs: number
  readonly state: PeriodDayState
}

export interface PeriodJob {
  readonly targetStartMs: number
  readonly targetEndMs: number
  readonly cursorPostedAtMs: number | null
}

/**
 * One cell per whole KST day of the period, oldest first.
 *
 * Empty when the period is empty or inverted rather than throwing: a job read
 * back from storage is data, and a screen that crashes on it is worse than one
 * that shows no cells. The window the operator can ask for is capped at 31 days
 * upstream, so this is always a row and never a wall.
 */
export function periodDays(job: PeriodJob): readonly PeriodDay[] {
  const firstDayMs = kstDayStartMs(job.targetStartMs)
  // The end is the midnight after the last day, so the last day is the one
  // holding the instant just before it.
  const lastDayMs = kstDayStartMs(job.targetEndMs - 1)
  if (!Number.isFinite(firstDayMs) || !Number.isFinite(lastDayMs) || lastDayMs < firstDayMs) return []

  const cursorDayMs = job.cursorPostedAtMs === null ? null : kstDayStartMs(job.cursorPostedAtMs)
  const days: PeriodDay[] = []
  for (let startMs = firstDayMs; startMs <= lastDayMs; startMs += DAY_MS) {
    days.push({ startMs, state: dayState(startMs, cursorDayMs) })
  }
  return days
}

function dayState(dayStartMs: number, cursorDayMs: number | null): PeriodDayState {
  if (cursorDayMs === null) return 'remaining'
  if (dayStartMs > cursorDayMs) return 'stored'
  if (dayStartMs === cursorDayMs) return 'walking'
  return 'remaining'
}

/** The oldest day still to be walked, for naming the remaining stretch. */
export function remainingFromMs(job: PeriodJob): number {
  return kstDayStartMs(job.targetStartMs)
}

/**
 * The newest day still to be walked — the one the cursor stands in, or the
 * whole period's last day when nothing has been walked yet.
 */
export function remainingToMs(job: PeriodJob): number {
  return job.cursorPostedAtMs === null
    ? kstDayStartMs(job.targetEndMs - 1)
    : kstDayStartMs(job.cursorPostedAtMs)
}
