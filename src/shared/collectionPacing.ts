import type { Random } from './ports.js'

/**
 * How fast a collection walk reads, inside a work block.
 *
 * Every page read waits a random gap first, and every 20th and 100th read
 * takes an extra break on top, so the traffic never settles into a fixed beat.
 * The operator sets the ranges; the points where the breaks fall are fixed.
 * Values are whole seconds.
 */
export interface DelayRange {
  readonly minSeconds: number
  readonly maxSeconds: number
}

export interface CollectionPacing {
  /** Gap before every page read after the first. */
  readonly perPage: DelayRange
  /** Extra break before every 20th read. */
  readonly everyTwentyPages: DelayRange
  /** Extra break before every 100th read, on top of the 20th-read one. */
  readonly everyHundredPages: DelayRange
}

export const SHORT_BREAK_EVERY = 20
export const LONG_BREAK_EVERY = 100

export const DEFAULT_COLLECTION_PACING: CollectionPacing = {
  perPage: { minSeconds: 3, maxSeconds: 6 },
  everyTwentyPages: { minSeconds: 30, maxSeconds: 90 },
  everyHundredPages: { minSeconds: 180, maxSeconds: 360 },
}

/** A page gap under a second is a burst, whatever the operator meant. */
export const MIN_PAGE_DELAY_SECONDS = 1
export const MAX_PAGE_DELAY_SECONDS = 60
export const MIN_BREAK_SECONDS = 0
export const MAX_BREAK_SECONDS = 3_600

const SECOND_MS = 1_000
const MINUTE_MS = 60_000

function clamp(value: unknown, fallback: number, low: number, high: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(high, Math.max(low, Math.round(number)))
}

function normalizeRange(value: Partial<DelayRange> | undefined, fallback: DelayRange, low: number, high: number): DelayRange {
  const min = clamp(value?.minSeconds, fallback.minSeconds, low, high)
  const max = clamp(value?.maxSeconds, fallback.maxSeconds, low, high)
  // The minimum is what the operator raised; the maximum follows it up rather
  // than the two trading places, which would move a value nobody touched.
  return { minSeconds: min, maxSeconds: Math.max(min, max) }
}

/** Brings anything read back from storage or sent by a screen into a runnable shape. */
export function normalizeCollectionPacing(value: {
  readonly perPage?: Partial<DelayRange>
  readonly everyTwentyPages?: Partial<DelayRange>
  readonly everyHundredPages?: Partial<DelayRange>
}): CollectionPacing {
  return {
    perPage: normalizeRange(value.perPage, DEFAULT_COLLECTION_PACING.perPage, MIN_PAGE_DELAY_SECONDS, MAX_PAGE_DELAY_SECONDS),
    everyTwentyPages: normalizeRange(value.everyTwentyPages, DEFAULT_COLLECTION_PACING.everyTwentyPages, MIN_BREAK_SECONDS, MAX_BREAK_SECONDS),
    everyHundredPages: normalizeRange(value.everyHundredPages, DEFAULT_COLLECTION_PACING.everyHundredPages, MIN_BREAK_SECONDS, MAX_BREAK_SECONDS),
  }
}

function drawMs(range: DelayRange, random: Random): number {
  return random.intInclusive(range.minSeconds * SECOND_MS, range.maxSeconds * SECOND_MS)
}

function midpointMs(range: DelayRange): number {
  return ((range.minSeconds + range.maxSeconds) / 2) * SECOND_MS
}

/** Delay before request ordinal N. The first request has no delay or break. */
export function collectionDelayMs(requestOrdinal: number, pacing: CollectionPacing, random: Random): number {
  if (requestOrdinal <= 1) return 0
  let delay = drawMs(pacing.perPage, random)
  if (requestOrdinal % SHORT_BREAK_EVERY === 0) delay += drawMs(pacing.everyTwentyPages, random)
  if (requestOrdinal % LONG_BREAK_EVERY === 0) delay += drawMs(pacing.everyHundredPages, random)
  return delay
}

/**
 * How many page requests fit in a work block at this pacing, taking the middle
 * of every range. The pacing is normalized first: its one-second page floor is
 * what bounds the count, and a draft still being typed may be below it.
 */
export function pagesPerWorkBlock(workBlockMinutes: number, draft: CollectionPacing): number {
  const pacing = normalizeCollectionPacing(draft)
  const blockMs = workBlockMinutes * MINUTE_MS
  let timeSpent = 0
  let requests = 1
  while (true) {
    const next = requests + 1
    let delay = midpointMs(pacing.perPage)
    if (next % SHORT_BREAK_EVERY === 0) delay += midpointMs(pacing.everyTwentyPages)
    if (next % LONG_BREAK_EVERY === 0) delay += midpointMs(pacing.everyHundredPages)
    if (timeSpent + delay > blockMs) return requests
    timeSpent += delay
    requests = next
  }
}
