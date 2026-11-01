import { MS_PER_DAY, kstDayStartMs } from './kst.js'
import { isMonthStartWindow, monthStartWindowDays } from './monthStart.js'

/**
 * A pass that finished within this many days counts as this month's: the
 * re-walk is owed only when nothing complete is that recent.
 */
export const MEMBER_RESYNC_RECENT_DAYS = 7

/** The windows looked ahead for the next due day; a pass finished just before one can skip it, never two. */
const LOOKAHEAD_MONTHS = 3

export interface MemberResyncTiming {
  /** Whether the automatic re-walk is on; the operator can still start one by hand. */
  readonly enabled: boolean
  /** When the first full walk completed; null while it has not. */
  readonly walkCompletedAtMs: number | null
  /** When the last re-walk completed; null if none ever has. */
  readonly resyncCompletedAtMs: number | null
}

function lastCompleteMs(timing: MemberResyncTiming): number | null {
  if (timing.walkCompletedAtMs === null) return null
  return Math.max(timing.walkCompletedAtMs, timing.resyncCompletedAtMs ?? timing.walkCompletedAtMs)
}

/** Whether a complete pass would still be owed on the KST day starting at `dayStartMs`. */
function owedOn(timing: MemberResyncTiming, dayStartMs: number): boolean {
  const last = lastCompleteMs(timing)
  return last !== null && last < dayStartMs - MEMBER_RESYNC_RECENT_DAYS * MS_PER_DAY
}

/**
 * Due on the first days of a month when no complete pass is from the last
 * week. Months whose first days were missed need no remembering: the next
 * month's window finds the same absence.
 */
export function isMemberResyncDue(timing: MemberResyncTiming, nowMs: number): boolean {
  if (!timing.enabled || !isMonthStartWindow(nowMs)) return false
  return owedOn(timing, kstDayStartMs(nowMs))
}

/** The KST midnight of the first window day the re-walk is owed on, or null when none will come: the first walk has not finished, or it is off. */
export function nextMemberResyncDueMs(timing: MemberResyncTiming, nowMs: number): number | null {
  if (!timing.enabled || timing.walkCompletedAtMs === null) return null
  return monthStartWindowDays(nowMs, LOOKAHEAD_MONTHS).find((day) => owedOn(timing, day)) ?? null
}
