import { kstDayRange, kstDayStartMs } from './kst.js'

/**
 * Operating rhythm: when and how long to read automatically.
 *
 * The collection reads during an active window, work-block by work-block. Each
 * work block lasts a fixed duration; after it ends, the app rests for another
 * fixed duration before the next block can start. If a block reaches its budget
 * before the duration runs out, it stops early; the rest still applies.
 *
 * The job itself — the period being collected and the cursor — lives in
 * `feed_state` and persists across scheduled runs.
 */
export interface CollectionSchedule {
  readonly enabled: boolean
  /** KST hour (0-23) when reads may start. Inclusive. */
  readonly activeWindowStartHourKst: number
  /** KST hour (0-23) when reads must stop. Exclusive. */
  readonly activeWindowEndHourKst: number
  /** Minutes of continuous work per scheduled block. */
  readonly workBlockMinutes: number
  /** Minutes of rest between work blocks. */
  readonly restMinutes: number
}

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export const DEFAULT_COLLECTION_SCHEDULE: CollectionSchedule = {
  enabled: false,
  activeWindowStartHourKst: 9,
  activeWindowEndHourKst: 21,
  workBlockMinutes: 120,
  restMinutes: 120,
}

export const MIN_WORK_BLOCK_MINUTES = 30
export const MAX_WORK_BLOCK_MINUTES = 480
export const MIN_REST_MINUTES = 30
export const MAX_REST_MINUTES = 480

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)))
}

/** Brings anything read back from storage into a shape the loop can run on. */
export function normalizeCollectionSchedule(value: Partial<CollectionSchedule>): CollectionSchedule {
  return {
    enabled: value.enabled === true,
    activeWindowStartHourKst: clamp(value.activeWindowStartHourKst ?? DEFAULT_COLLECTION_SCHEDULE.activeWindowStartHourKst, 0, 23),
    activeWindowEndHourKst: clamp(value.activeWindowEndHourKst ?? DEFAULT_COLLECTION_SCHEDULE.activeWindowEndHourKst, 0, 23),
    workBlockMinutes: clamp(value.workBlockMinutes ?? DEFAULT_COLLECTION_SCHEDULE.workBlockMinutes, MIN_WORK_BLOCK_MINUTES, MAX_WORK_BLOCK_MINUTES),
    restMinutes: clamp(value.restMinutes ?? DEFAULT_COLLECTION_SCHEDULE.restMinutes, MIN_REST_MINUTES, MAX_REST_MINUTES),
  }
}

/**
 * How many page requests fit in a work block, given the pacing delays.
 * Uses the delay rule already in collectionOrchestrator.ts:
 * - First request: 0ms
 * - Subsequent requests: 5–9s each
 * - Every 20th request adds 2–5min
 * - Every 100th request adds 10–20min
 *
 * This returns a conservative estimate (worst-case): middle delays.
 */
export function pagesPerWorkBlock(workBlockMinutes: number): number {
  const blockMs = workBlockMinutes * MINUTE_MS
  // Conservative (worst-case) delays: 7s base, 3:30min per 20th, 15min per 100th
  let timeSpent = 0
  let requests = 0

  for (requests = 1; requests <= 500; requests++) {
    if (requests === 1) {
      // First request has no delay
    } else {
      timeSpent += 7_000 // 5–9s middle point
    }
    if (requests % 20 === 0) {
      timeSpent += 3.5 * 60 * 1_000 // 2–5min middle point
    }
    if (requests % 100 === 0) {
      timeSpent += 15 * 60 * 1_000 // 10–20min middle point
    }
    if (timeSpent > blockMs) {
      return Math.max(1, requests - 1)
    }
  }
  return requests
}

/**
 * When the next scheduled read is due, or null when nothing is scheduled.
 *
 * The time is the start of the next work block that fits in the active window.
 * Previous run timing is not considered here; the caller supplies the last run
 * end time and rest duration if a resume is in progress.
 */
export interface NextRunOptions {
  /** When the last block ended, so the next one comes a rest later. */
  readonly lastRunEndMs?: number
  /**
   * Runs the rhythm around the clock. Only the hours give way: a collection
   * switched off stays off, and the work and rest lengths are untouched, so
   * the cafe sees the same pacing at four in the morning as at noon.
   */
  readonly ignoreActiveWindow?: boolean
}

export function nextCollectionRunTime(
  nowMs: number,
  schedule: CollectionSchedule,
  options: NextRunOptions = {},
): number | null {
  if (!schedule.enabled) return null

  // If we just finished a run, the next one comes after the rest period.
  const candidateMs = options.lastRunEndMs
    ? options.lastRunEndMs + schedule.restMinutes * MINUTE_MS
    : nowMs

  if (options.ignoreActiveWindow === true) return candidateMs
  // Clamp to the next active window start if needed.
  return clampToNextActiveWindow(candidateMs, schedule)
}

/**
 * Clamps a time to fit within or jump to the next active window.
 * Returns null if disabled or time is already beyond any reachable window.
 */
function clampToNextActiveWindow(timeMs: number, schedule: CollectionSchedule): number | null {
  const dayStart = kstDayStartMs(timeMs)
  const windowStartMs = dayStart + schedule.activeWindowStartHourKst * HOUR_MS
  const windowEndMs = dayStart + schedule.activeWindowEndHourKst * HOUR_MS

  if (timeMs < windowEndMs) {
    // We're before the window ends today.
    if (timeMs < windowStartMs) {
      // Before the window starts; clamp to its start.
      return windowStartMs
    }
    // Inside the window.
    return timeMs
  }

  // After today's window; jump to tomorrow's.
  const nextDayStart = dayStart + DAY_MS
  const nextWindowStart = nextDayStart + schedule.activeWindowStartHourKst * HOUR_MS
  return nextWindowStart
}

export interface CollectionRange {
  readonly startMs: number
  readonly endMs: number
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
 * has not happened yet is refused rather than silently returning nothing.
 */
export function checkCollectionRange(
  range: CollectionRange,
  nowMs: number,
): CollectionRangeProblem | null {
  if (range.endMs <= range.startMs) return 'EMPTY_RANGE'
  if (range.startMs >= nowMs) return 'NOT_YET'
  return null
}
