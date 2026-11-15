import { MS_PER_DAY, kstCalendarOf } from './kst.js'

export type AttendanceKind = 'comment' | 'post' | 'visit'

export interface AttendancePeriod {
  readonly startDay: string
  readonly endDay: string
} // YYYY-MM-DD, KST

export type AttendanceTitle =
  | { readonly kind: 'other' }
  | { readonly kind: 'attendance'; readonly attendanceKind: AttendanceKind; readonly period: AttendancePeriod | null }

/**
 * A round whose last day sits further back than this before the post is one
 * whose year we would only be guessing at, so we read the kind but leave the
 * period empty rather than invent one.
 */
const MAX_DAYS_END_BEFORE_POST = 7

// The kind is decided by the bracket that opens the title; whitespace inside it
// is tolerated. 댓글 → comment, 게시글 → post, 방문 → visit.
const KIND_BY_LABEL: Readonly<Record<string, AttendanceKind>> = {
  댓글: 'comment',
  게시글: 'post',
  방문: 'visit',
}
const OPENING_BRACKET = /^\[\s*(댓글|게시글|방문)\s*개근\s*\]/
const PERIOD = /(\d{1,2})월\s*(\d{1,2})일\s*~\s*(\d{1,2})월\s*(\d{1,2})일/

interface CalendarDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDay(date: CalendarDate): string {
  return `${date.year}-${two(date.month)}-${two(date.day)}`
}

/** Whether the month/day pair is a real date in the given year (e.g. rejects 2월 30일). */
function isRealDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

/** Negative when the first date is earlier; the count of calendar days between them. */
function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const fromMs = Date.UTC(from.year, from.month - 1, from.day)
  const toMs = Date.UTC(to.year, to.month - 1, to.day)
  return (toMs - fromMs) / MS_PER_DAY
}

/** True when `a` falls on or before `b`, comparing whole calendar dates. */
function onOrBefore(a: CalendarDate, b: CalendarDate): boolean {
  if (a.year !== b.year) return a.year < b.year
  if (a.month !== b.month) return a.month < b.month
  return a.day <= b.day
}

/** True when `a`'s month/day falls after `b`'s, ignoring the year. */
function monthDayAfter(a: { month: number; day: number }, b: { month: number; day: number }): boolean {
  if (a.month !== b.month) return a.month > b.month
  return a.day > b.day
}

/**
 * The latest year whose `month/day` is a real date on or before `posted`.
 *
 * The round's title never carries a year, so the post's own day anchors it: the
 * end day is the most recent occurrence of that month/day that has already
 * happened by the time the post went up.
 */
function endYearFor(month: number, day: number, posted: CalendarDate): number | null {
  for (const year of [posted.year, posted.year - 1]) {
    if (isRealDate(year, month, day) && onOrBefore({ year, month, day }, posted)) return year
  }
  return null
}

function readPeriod(afterBracket: string, postedAtMs: number): AttendancePeriod | null {
  const match = PERIOD.exec(afterBracket)
  if (match === null) return null

  const startMonth = Number(match[1])
  const startDay = Number(match[2])
  const endMonth = Number(match[3])
  const endDay = Number(match[4])

  const posted = kstCalendarOf(postedAtMs)
  const endYear = endYearFor(endMonth, endDay, posted)
  if (endYear === null) return null

  const end: CalendarDate = { year: endYear, month: endMonth, day: endDay }
  if (daysBetween(end, posted) > MAX_DAYS_END_BEFORE_POST) return null

  // A round that crosses the new year starts in the year before the end.
  const startYear = monthDayAfter({ month: startMonth, day: startDay }, { month: endMonth, day: endDay })
    ? endYear - 1
    : endYear
  if (!isRealDate(startYear, startMonth, startDay)) return null

  return { startDay: formatDay({ year: startYear, month: startMonth, day: startDay }), endDay: formatDay(end) }
}

export function parseAttendanceTitle(title: string | null, postedAtMs: number): AttendanceTitle {
  if (title === null) return { kind: 'other' }

  const bracket = OPENING_BRACKET.exec(title)
  if (bracket === null) return { kind: 'other' }

  const label = bracket[1]
  const attendanceKind = label === undefined ? undefined : KIND_BY_LABEL[label]
  if (attendanceKind === undefined) return { kind: 'other' }

  const period = readPeriod(title.slice(bracket[0].length), postedAtMs)
  return { kind: 'attendance', attendanceKind, period }
}
