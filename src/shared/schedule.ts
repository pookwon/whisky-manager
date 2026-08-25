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

function isWeekend(epochMs: number, clock: Clock): boolean {
  const { dayOfWeek } = clock.parts(epochMs)
  return dayOfWeek === SATURDAY || dayOfWeek === SUNDAY
}

export function nextSessionStart(
  previousSessionEndMs: number,
  limits: Limits,
  clock: Clock,
  random: Random,
): number {
  const base = random.intInclusive(limits.sessionIntervalMinMs, limits.sessionIntervalMaxMs)
  const multiplier = isWeekend(previousSessionEndMs, clock) ? limits.weekendIntervalMultiplier : 1
  const candidate = previousSessionEndMs + Math.round(base * multiplier)

  return isWithinActiveHours(candidate, limits, clock)
    ? candidate
    : nextActiveStart(candidate, limits, clock)
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
