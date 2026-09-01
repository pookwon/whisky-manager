import { kstDayStartMs } from '../../../shared/kst.js'
import { kstHourOf } from '../../format.js'

/**
 * The geometry behind the dashboard's day band, kept apart from the component
 * that paints it. Every number here is a percentage of one drawn stretch of one
 * KST day, which is the only thing the ribbon actually knows how to show.
 */

const HOUR_MS = 3_600_000

/** An operating window as its owner stores it: start inclusive, end exclusive. */
export interface ActiveWindow {
  readonly startHour: number
  readonly endHour: number
}

/** The stretch of one KST day the ribbon draws, in whole hours. */
export interface RhythmSpan {
  readonly dayStartMs: number
  readonly startHour: number
  readonly endHour: number
}

/** A left offset and a width, both as percentages of the drawn span. */
export interface RhythmBand {
  readonly leftPercent: number
  readonly widthPercent: number
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Which hours to draw.
 *
 * Wide enough to hold every operating window whole — a window clipped at the
 * edge reads as one that never closes — and always wide enough to hold now, so
 * the cursor is never pinned to an edge that means something else. An hour of
 * air on the left keeps the first window from starting flush against nothing.
 */
export function rhythmSpan(nowMs: number, windows: readonly ActiveWindow[]): RhythmSpan {
  const nowHour = kstHourOf(nowMs)
  const starts = [...windows.map((window) => window.startHour), nowHour]
  const ends = [...windows.map((window) => window.endHour), nowHour + 1]
  const startHour = clamp(Math.min(...starts) - 1, 0, 23)
  return {
    dayStartMs: kstDayStartMs(nowMs),
    startHour,
    endHour: clamp(Math.max(...ends), startHour + 1, 24),
  }
}

/** The instant an hour of the drawn day begins. */
function hourMs(span: RhythmSpan, hour: number): number {
  return span.dayStartMs + hour * HOUR_MS
}

function spanMs(span: RhythmSpan): number {
  return (span.endHour - span.startHour) * HOUR_MS
}

/**
 * Where an instant sits on the band, 0–100.
 *
 * Clamped rather than allowed off the end: a run that started before the drawn
 * stretch belongs at its edge, not outside the box where nothing paints it.
 */
export function rhythmPercent(epochMs: number, span: RhythmSpan): number {
  const offset = epochMs - hourMs(span, span.startHour)
  return round(clamp((offset / spanMs(span)) * 100, 0, 100))
}

/**
 * A stretch of time as a band, or null when none of it is on screen.
 *
 * Null rather than a zero-width band: a band of no width still paints its
 * border, and a one-pixel line at the edge of the day is read as an event.
 */
export function rhythmBand(fromMs: number, toMs: number, span: RhythmSpan): RhythmBand | null {
  const left = rhythmPercent(fromMs, span)
  const right = rhythmPercent(toMs, span)
  if (right <= left) return null
  return { leftPercent: left, widthPercent: round(right - left) }
}

/** An operating window as a band on the same stretch. */
export function windowBand(window: ActiveWindow, span: RhythmSpan): RhythmBand | null {
  return rhythmBand(hourMs(span, window.startHour), hourMs(span, window.endHour), span)
}

/** One label on the hour axis. */
export interface HourMark {
  readonly hour: number
  readonly leftPercent: number
}

const MARK_STEP_HOURS = 3

/**
 * The hours worth labelling: every third one, plus both ends of the drawn
 * stretch. The ends are what let a reader tell an empty morning from a morning
 * that is simply not drawn.
 */
export function hourMarks(span: RhythmSpan): readonly HourMark[] {
  const hours = new Set<number>([span.startHour, span.endHour])
  const first = Math.ceil(span.startHour / MARK_STEP_HOURS) * MARK_STEP_HOURS
  for (let hour = first; hour < span.endHour; hour += MARK_STEP_HOURS) hours.add(hour)
  return [...hours]
    .sort((a, b) => a - b)
    .map((hour) => ({ hour, leftPercent: rhythmPercent(hourMs(span, hour), span) }))
}

/** A run as the ribbon needs it, which is less than a run summary carries. */
export interface RunBlock {
  readonly startedAtMs: number
  readonly finishedAtMs: number | null
}

/**
 * The runs that belong to the day being drawn.
 *
 * A run is placed by when it started: one that began before midnight and is
 * still going belongs to the day it started on, and drawing it on today's band
 * would put a block where nothing happened today.
 */
export function runsOnDay(runs: readonly RunBlock[], span: RhythmSpan): readonly RunBlock[] {
  const endMs = span.dayStartMs + 24 * HOUR_MS
  return runs.filter((run) => run.startedAtMs >= span.dayStartMs && run.startedAtMs < endMs)
}
