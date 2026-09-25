/**
 * Naver renders cafe timestamps in the cafe's own timezone. The offset is
 * written once, here, so no caller has to remember it.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export const MS_PER_DAY = 86_400_000

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

const HOURS_PER_DAY = 24

/** The hour of the KST clock an instant fell in, 0–23. */
export function kstHourOf(epochMs: number): number {
  return new Date(epochMs + KST_OFFSET_MS).getUTCHours()
}

/**
 * How many of the instants fell in each KST hour, as twenty-four counts.
 *
 * The day the instants belong to is the caller's business — this only reads
 * the hour — so a list spanning two days folds them onto one clock face.
 */
export function countByKstHour(epochMs: readonly number[]): readonly number[] {
  // Built up locally and handed out read-only: nothing else holds this array
  // while it is being filled, so filling it in place has no one to surprise.
  const counts = Array.from({ length: HOURS_PER_DAY }, () => 0)
  for (const instant of epochMs) counts[kstHourOf(instant)] = (counts[kstHourOf(instant)] ?? 0) + 1
  return counts
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

const DAY_KEY = /^(\d{4})(\d{2})(\d{2})$/
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** The UTC instant of a KST wall-clock reading, or null when no such reading exists. */
function kstWallClockMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number | null {
  if (hour > 23 || minute > 59 || second > 59) return null
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms)
  const check = new Date(asUtc)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return asUtc - KST_OFFSET_MS
}

/** The KST calendar day of an instant as `yyyymmdd`, the spelling the cafe's search takes. */
export function kstDayKey(epochMs: number): string {
  const shifted = new Date(kstDayStartMs(epochMs) + KST_OFFSET_MS)
  return `${shifted.getUTCFullYear()}${two(shifted.getUTCMonth() + 1)}${two(shifted.getUTCDate())}`
}

export function isKstDayKey(value: string): boolean {
  const match = DAY_KEY.exec(value)
  return match !== null && kstWallClockMs(Number(match[1]), Number(match[2]), Number(match[3])) !== null
}

/** The KST day a `yyyymmdd` key names, as a half-open range. */
export function kstDayKeyRange(key: string): KstDay {
  const match = DAY_KEY.exec(key)
  const startMs = match === null ? null : kstWallClockMs(Number(match[1]), Number(match[2]), Number(match[3]))
  if (startMs === null) throw new Error(`not a KST day key: ${key}`)
  return { startMs, endMs: startMs + MS_PER_DAY }
}

/**
 * An offset-less wall-clock time such as `2025-01-31T23:59:26.667`, read as
 * KST. The cafe's search spells post times this way; handing the string to
 * `Date.parse` would read it in the machine's own zone.
 */
export function kstLocalDateTimeToEpochMs(value: string): number | null {
  const match = LOCAL_DATE_TIME.exec(value)
  if (match === null) return null
  const fraction = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'))
  return kstWallClockMs(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]), fraction)
}
