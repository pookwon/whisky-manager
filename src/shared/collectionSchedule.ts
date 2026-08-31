import { kstDayRange, kstDayStartMs } from './kst.js'

/**
 * How often the board collection reads on its own.
 *
 * `MANUAL` is not "off" — the feature stays switched on and the operator starts
 * every run themselves. Off is `enabled: false`, which is a different answer to
 * a different question.
 */
export type CollectionInterval = 'SIX_HOURS' | 'TWELVE_HOURS' | 'DAILY' | 'MANUAL'

export interface CollectionSchedule {
  readonly enabled: boolean
  readonly interval: CollectionInterval
  /**
   * Minutes past KST midnight the cycle is anchored to. Every interval divides
   * a day evenly, so one anchor decides the whole grid: 02:00 with a six-hour
   * interval means 02:00, 08:00, 14:00, 20:00 and nothing else.
   */
  readonly baseMinuteOfDayKst: number
  /** How far back a scheduled run reads, in days. */
  readonly rangeDays: number
  /** Requests one run may spend, rewind reads included. */
  readonly maxPages: number
}

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export const COLLECTION_INTERVAL_MS: Record<Exclude<CollectionInterval, 'MANUAL'>, number> = {
  SIX_HOURS: 6 * HOUR_MS,
  TWELVE_HOURS: 12 * HOUR_MS,
  DAILY: DAY_MS,
}

export const DEFAULT_COLLECTION_SCHEDULE: CollectionSchedule = {
  // Off until an operator turns it on: a tool that starts reaching the cafe on
  // its own the moment a database appears is not one they chose to run.
  enabled: false,
  interval: 'SIX_HOURS',
  baseMinuteOfDayKst: 2 * 60,
  rangeDays: 3,
  maxPages: 99,
}

export const MIN_RANGE_DAYS = 1
export const MAX_RANGE_DAYS = 31
export const MIN_MAX_PAGES = 1
/**
 * Ninety-nine keeps a run under the hundredth request, where the pacing adds a
 * ten-to-twenty minute rest. Past that a run is better split in two.
 */
export const MAX_MAX_PAGES = 400

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)))
}

/** Brings anything read back from storage into a shape the loop can run on. */
export function normalizeCollectionSchedule(value: Partial<CollectionSchedule>): CollectionSchedule {
  const interval: CollectionInterval =
    value.interval === 'TWELVE_HOURS' || value.interval === 'DAILY' || value.interval === 'MANUAL'
      ? value.interval
      : 'SIX_HOURS'
  return {
    enabled: value.enabled === true,
    interval,
    baseMinuteOfDayKst: clamp(value.baseMinuteOfDayKst ?? DEFAULT_COLLECTION_SCHEDULE.baseMinuteOfDayKst, 0, 24 * 60 - 1),
    rangeDays: clamp(value.rangeDays ?? DEFAULT_COLLECTION_SCHEDULE.rangeDays, MIN_RANGE_DAYS, MAX_RANGE_DAYS),
    maxPages: clamp(value.maxPages ?? DEFAULT_COLLECTION_SCHEDULE.maxPages, MIN_MAX_PAGES, MAX_MAX_PAGES),
  }
}

/**
 * When the next scheduled read is due, or null when nothing is scheduled.
 *
 * Anchored to KST midnight rather than to the app's start, so the times an
 * operator is told are the times they can predict — restarting the app at
 * 03:41 does not move a 02:00 cycle to 03:41.
 */
export function nextCollectionRun(nowMs: number, schedule: CollectionSchedule): number | null {
  if (!schedule.enabled || schedule.interval === 'MANUAL') return null
  const step = COLLECTION_INTERVAL_MS[schedule.interval]
  // Starts a day back so the grid is entered from below whatever the base is.
  let at = kstDayStartMs(nowMs) + schedule.baseMinuteOfDayKst * 60_000 - DAY_MS
  while (at <= nowMs) at += step
  return at
}

export interface CollectionRange {
  readonly startMs: number
  readonly endMs: number
}

/** What a scheduled run asks for: the configured window ending now. */
export function scheduledCollectionRange(nowMs: number, schedule: CollectionSchedule): CollectionRange {
  return { startMs: nowMs - schedule.rangeDays * DAY_MS, endMs: nowMs }
}

/**
 * The window two KST dates name, first day's start to last day's end. Given in
 * whole days because that is what the operator picks; the collection filters to
 * the exact instants either way.
 */
export function collectionRangeOfDays(firstDayMs: number, lastDayMs: number): CollectionRange {
  return { startMs: kstDayRange(firstDayMs).startMs, endMs: kstDayRange(lastDayMs).endMs }
}

export type CollectionRangeProblem = 'EMPTY_RANGE' | 'TOO_LONG' | 'NOT_YET'

/**
 * Why a chosen window cannot be collected, or null when it can. A window that
 * has not happened yet is refused rather than silently returning nothing, and
 * one longer than a month is refused because it is a backfill, not a top-up.
 */
export function checkCollectionRange(
  range: CollectionRange,
  nowMs: number,
): CollectionRangeProblem | null {
  if (range.endMs <= range.startMs) return 'EMPTY_RANGE'
  if (range.startMs >= nowMs) return 'NOT_YET'
  if (range.endMs - range.startMs > MAX_RANGE_DAYS * DAY_MS) return 'TOO_LONG'
  return null
}
