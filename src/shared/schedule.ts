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
