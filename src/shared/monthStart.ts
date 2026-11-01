import { MS_PER_DAY, kstCalendarOf, kstDayStartMs, kstMonthRange, type KstDay } from './kst.js'

/** The month's first days, KST, on which the monthly collections check whether they are owed. */
export const MONTH_START_WINDOW_DAYS = 3

export function isMonthStartWindow(nowMs: number): boolean {
  return kstCalendarOf(nowMs).day <= MONTH_START_WINDOW_DAYS
}

/** The KST calendar month before the one `nowMs` falls in, as a half-open range. */
export function previousKstMonthRange(nowMs: number): KstDay {
  const { year, month } = kstCalendarOf(nowMs)
  return month === 1 ? kstMonthRange(year - 1, 12) : kstMonthRange(year, month - 1)
}

/** The KST midnights of the next window days at or after `nowMs`'s day, soonest first. */
export function monthStartWindowDays(nowMs: number, months: number): readonly number[] {
  const { year, month } = kstCalendarOf(nowMs)
  const today = kstDayStartMs(nowMs)
  const days: number[] = []
  for (let offset = 0; offset < months; offset += 1) {
    const first = kstMonthRange(year + Math.floor((month - 1 + offset) / 12), ((month - 1 + offset) % 12) + 1).startMs
    for (let day = 0; day < MONTH_START_WINDOW_DAYS; day += 1) {
      const at = first + day * MS_PER_DAY
      if (at >= today) days.push(at)
    }
  }
  return days
}
