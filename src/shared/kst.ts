/**
 * Naver renders cafe timestamps in the cafe's own timezone, and the member list
 * gives join dates with no time at all. Both live here so the offset is written
 * once, and so a date-only value is never compared as though it carried a clock.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const MS_PER_DAY = 86_400_000
const JOIN_DATE = /^(\d{4})\.(\d{2})\.(\d{2})\.$/

/** Days since the epoch, counted on the KST calendar. */
export function kstDayOf(epochMs: number): number {
  return Math.floor((epochMs + KST_OFFSET_MS) / MS_PER_DAY)
}

/** `null` when the string is not the `2026.08.23.` shape the cafe sends. */
export function joinDateToKstDay(joinDate: string): number | null {
  const match = JOIN_DATE.exec(joinDate)
  if (match === null) return null
  const [, year, month, day] = match
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / MS_PER_DAY)
}

/**
 * Inverse of `joinDateToKstDay`. Pruning compares join dates as strings, which
 * only works because the format is zero-padded and therefore sorts by date.
 */
export function kstDayToJoinDate(day: number): string {
  const date = new Date(day * MS_PER_DAY)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}.`
}
