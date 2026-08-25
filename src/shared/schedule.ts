import { nextDayClosing } from './dayClosing.js'
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

/**
 * The longest a session can take: every execution it is allowed, each waiting
 * the widest gap before it. An estimate, and deliberately the pessimistic one —
 * the only question it answers is "would starting now still be running when the
 * day ends?", and guessing yes costs a wait while guessing no costs the day.
 */
function longestSessionMs(limits: Limits): number {
  return limits.perSessionCap * limits.actionIntervalMaxMs
}

/**
 * No day goes unclosed. The tail of the day belongs to the run that settles it,
 * and a drawn interval either fits ahead of that run or gives way to it.
 *
 * Two calendars meet here, and they are meant to. The operating window is read
 * through the clock, which keeps the machine's day; the closing run is pinned to
 * the KST day, because that is the day collection floors at. On a machine
 * keeping the cafe's own time — the one this is built for — they are the same
 * day. On any other, the window is already answering for a day the cafe does
 * not have, and the closing run staying with the cafe is the half worth keeping.
 *
 * Both halves of the rule are needed. An interval left alone steps over midnight and the
 * day rolls over with its last arrivals unanswered — collection floors at the
 * new day's midnight, so nothing afterwards ever looks at them again. Clamping
 * it to the closing moment is not enough either: a session drawn at, say, 23:00
 * would still be working at 23:59, and the loop only asks for the next session
 * once the current one ends, so the closing run would simply never start.
 */
export function nextSessionStart(
  previousSessionEndMs: number,
  limits: Limits,
  clock: Clock,
  random: Random,
): number {
  const base = random.intInclusive(limits.sessionIntervalMinMs, limits.sessionIntervalMaxMs)
  const multiplier = isWeekend(previousSessionEndMs, clock) ? limits.weekendIntervalMultiplier : 1
  const candidate = previousSessionEndMs + Math.round(base * multiplier)

  const drawn = isWithinActiveHours(candidate, limits, clock)
    ? candidate
    : nextActiveStart(candidate, limits, clock)

  const closing = nextDayClosing(previousSessionEndMs)
  return drawn + longestSessionMs(limits) > closing ? closing : drawn
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
