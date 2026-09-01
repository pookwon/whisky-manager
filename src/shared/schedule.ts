import { nextDaySettle } from './daySettling.js'
import type { Clock, Random } from './ports.js'
import type { Limits } from './types.js'

const SUNDAY = 0
const SATURDAY = 6

export function isWithinActiveHours(epochMs: number, limits: Limits, clock: Clock): boolean {
  const { hour } = clock.parts(epochMs)
  return hour >= limits.activeHourStart && hour < limits.activeHourEnd
}

/**
 * The next moment the operating window opens. Callers that mean "now" should
 * check `isWithinActiveHours` first; this always returns a future boundary.
 */
export function nextActiveStart(epochMs: number, limits: Limits, clock: Clock): number {
  const { hour } = clock.parts(epochMs)
  if (hour < limits.activeHourStart) {
    return clock.atHour(epochMs, limits.activeHourStart)
  }
  return clock.atHour(clock.addDays(epochMs, 1), limits.activeHourStart)
}

/**
 * How far into the window the session that was waiting for it may land.
 *
 * Never zero. A session aimed at the exact instant the window opens has no
 * margin: the gate that admits it reads the clock a second time when it runs,
 * and anything that puts that read on the earlier side of the boundary — a
 * timer that fires before its due instant, a clock nudged back between the two
 * reads — refuses the session the schedule itself aimed at the opening, and the
 * refusal costs the whole interval to the next one.
 *
 * A band rather than a fixed offset, for the reason every interval here is
 * drawn: the first session of the day is the most predictable one there is, and
 * arriving on the same second every morning is the shape of a machine.
 */
const OPENING_SPREAD_MIN_MS = 60_000
const OPENING_SPREAD_MAX_MS = 15 * 60_000

/**
 * When the session that waited out a closed window should open: shortly after
 * the window does, rather than on the instant it does.
 */
function nextOpeningStart(
  epochMs: number,
  limits: Limits,
  clock: Clock,
  random: Random,
): number {
  return (
    nextActiveStart(epochMs, limits, clock) +
    random.intInclusive(OPENING_SPREAD_MIN_MS, OPENING_SPREAD_MAX_MS)
  )
}

function isWeekend(epochMs: number, clock: Clock): boolean {
  const { dayOfWeek } = clock.parts(epochMs)
  return dayOfWeek === SATURDAY || dayOfWeek === SUNDAY
}

export interface NextSession {
  readonly at: number
  readonly mode: 'SCHEDULED' | 'SETTLE'
}

/**
 * When the next session opens, and what kind it is.
 *
 * Two calendars meet here, and they are meant to. The operating window is read
 * through the clock, which keeps the machine's day; the settle run is pinned to
 * the KST day, because that is the day collection floors at. On a machine
 * keeping the cafe's own time — the one this is built for — they are the same
 * day.
 *
 * The earlier of the two wins, and that is the whole rule. A draw landing
 * inside the operating window is an ordinary session; a draw that steps over
 * midnight gives way to the run that settles the day it left behind. Nothing
 * here has to reason about whether a session will still be running at the
 * boundary: a settle run that a long session pushes past is picked up by the
 * next session, which checks what is owed before it works its own day.
 */
export function nextSessionStart(
  previousSessionEndMs: number,
  limits: Limits,
  clock: Clock,
  random: Random,
): NextSession {
  const base = random.intInclusive(limits.sessionIntervalMinMs, limits.sessionIntervalMaxMs)
  const multiplier = isWeekend(previousSessionEndMs, clock) ? limits.weekendIntervalMultiplier : 1
  const candidate = previousSessionEndMs + Math.round(base * multiplier)

  const drawn = isWithinActiveHours(candidate, limits, clock)
    ? candidate
    : nextOpeningStart(candidate, limits, clock, random)

  const settleAt = nextDaySettle(previousSessionEndMs, random)
  return settleAt < drawn ? { at: settleAt, mode: 'SETTLE' } : { at: drawn, mode: 'SCHEDULED' }
}

export function nextActionDelayMs(limits: Limits, random: Random): number {
  return random.intInclusive(limits.actionIntervalMinMs, limits.actionIntervalMaxMs)
}

/**
 * Delay between successive page requests during collection. Drawn at random to
 * avoid mechanical-looking traffic patterns that might trigger rate limits.
 * The bounds are chosen to stay well under the extension's 30s message timeout
 * while giving Naver time to serve responses.
 */
const PAGE_FETCH_MIN_MS = 1_750
const PAGE_FETCH_MAX_MS = 2_500

export function nextPageFetchDelayMs(random: Random): number {
  return random.intInclusive(PAGE_FETCH_MIN_MS, PAGE_FETCH_MAX_MS)
}

/**
 * Delay before asking a post who commented on it. Shorter than the page gap
 * because these are single reads rather than a walk, and drawn at random for
 * the same reason everything else here is: a fixed beat is what gets noticed.
 */
const COMMENT_LOOKUP_MIN_MS = 1_000
const COMMENT_LOOKUP_MAX_MS = 1_500

export function nextCommentLookupDelayMs(random: Random): number {
  return random.intInclusive(COMMENT_LOOKUP_MIN_MS, COMMENT_LOOKUP_MAX_MS)
}

/**
 * Gap between the reads that keep the browser's naver login warm. About an
 * hour: long enough that a day of it is a rounding error next to one session's
 * traffic, short enough to sit well inside any idle window naver measures.
 *
 * A band rather than the hour itself, for the reason every interval here is
 * drawn: a read landing on the same minute of every hour is the shape of a
 * machine.
 */
const WARM_MIN_MS = 50 * 60_000
const WARM_MAX_MS = 70 * 60_000

export function nextWarmDelayMs(random: Random): number {
  return random.intInclusive(WARM_MIN_MS, WARM_MAX_MS)
}
