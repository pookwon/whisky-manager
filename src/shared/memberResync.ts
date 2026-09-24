import { MS_PER_DAY, kstDayStartMs } from './kst.js'

/**
 * How often the whole member list is walked again, in days. Zero turns the
 * automatic re-walk off; the operator can still start one by hand. The choices
 * are few on purpose: a walk takes about ten days of blocks shared with the
 * boards, so anything shorter than two weeks would never rest.
 */
export const MEMBER_RESYNC_INTERVAL_CHOICES = [0, 14, 30, 60] as const
export const DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS = 30

export type MemberResyncIntervalDays = (typeof MEMBER_RESYNC_INTERVAL_CHOICES)[number]

/** Anything that is not one of the choices reads as the default. */
export function normalizeMemberResyncInterval(value: unknown): MemberResyncIntervalDays {
  const match = MEMBER_RESYNC_INTERVAL_CHOICES.find((choice) => choice === value)
  return match ?? DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS
}

export interface MemberResyncTiming {
  readonly intervalDays: MemberResyncIntervalDays
  /** When the first full walk completed; null while it has not. */
  readonly walkCompletedAtMs: number | null
  /** When the last re-walk completed; null if none ever has. */
  readonly resyncCompletedAtMs: number | null
}

/**
 * When the next automatic re-walk is due, or null when none will come: the
 * first walk has not finished, or the automatic re-walk is off.
 *
 * Counted in KST days from the day the last complete pass finished — the
 * re-walk's, or the first walk's before there has been one — so a pass that
 * ends late in the evening does not push the next one to an afternoon.
 */
export function nextMemberResyncDueMs(timing: MemberResyncTiming): number | null {
  if (timing.walkCompletedAtMs === null || timing.intervalDays === 0) return null
  const since = timing.resyncCompletedAtMs ?? timing.walkCompletedAtMs
  return kstDayStartMs(since) + timing.intervalDays * MS_PER_DAY
}

export function isMemberResyncDue(timing: MemberResyncTiming, nowMs: number): boolean {
  const due = nextMemberResyncDueMs(timing)
  return due !== null && nowMs >= due
}
