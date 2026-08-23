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
