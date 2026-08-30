/**
 * Naver renders cafe timestamps in the cafe's own timezone. The offset is
 * written once, here, so no caller has to remember it.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const MS_PER_DAY = 86_400_000

/** Days since the epoch, counted on the KST calendar. */
function kstDayOf(epochMs: number): number {
  return Math.floor((epochMs + KST_OFFSET_MS) / MS_PER_DAY)
}

/**
 * The instant midnight KST began, for the KST day containing `epochMs`.
 *
 * The day number counts days that were shifted forward by the offset, so
 * shifting back is what turns it into an instant again. Without that the result
 * lands on UTC midnight — nine hours into the KST day — and a floor built from
 * it sits in the future all morning, matching nothing.
 */
export function kstDayStartMs(epochMs: number): number {
  return kstDayOf(epochMs) * MS_PER_DAY - KST_OFFSET_MS
}

export interface KstDay {
  readonly startMs: number
  /** Exclusive: the instant the next KST day begins. */
  readonly endMs: number
}

/**
 * The KST day containing `epochMs`, as a half-open range. Callers that ask
 * "does this belong to that day" need both ends, and taking them from one place
 * keeps a day's length from being spelled out at each of them.
 */
export function kstDayRange(epochMs: number): KstDay {
  const startMs = kstDayStartMs(epochMs)
  return { startMs, endMs: startMs + MS_PER_DAY }
}

/** The three fully completed KST days immediately before the supplied anchor. */
export function recentCompletedKstDays(anchorMs: number, days = 3): KstDay {
  if (!Number.isSafeInteger(days) || days < 1) throw new Error('days must be a positive safe integer')
  const endMs = kstDayStartMs(anchorMs)
  return { startMs: endMs - days * MS_PER_DAY, endMs }
}

/** A half-open calendar-month range whose boundaries are KST midnight instants. */
export function kstMonthRange(year: number, month: number): KstDay {
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new Error('year and month must identify a calendar month')
  }
  const startMs = Date.UTC(year, month - 1, 1) - KST_OFFSET_MS
  const endMs = Date.UTC(year, month, 1) - KST_OFFSET_MS
  return { startMs, endMs }
}
