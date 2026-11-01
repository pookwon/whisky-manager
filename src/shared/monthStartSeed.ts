/** A half-open period of a collection job, as KST instants. */
export interface SeededPeriod {
  readonly startMs: number
  readonly endMs: number
}

/**
 * The job the month start made on its own, and the finished one it replaced.
 * Kept so the dashboard can say where a job it never saw asked for came from.
 */
export interface MonthStartSeed {
  readonly period: SeededPeriod
  /** The job that was in the way, finished; null when there was none. */
  readonly replaced: SeededPeriod | null
  readonly madeAtMs: number
}

const isPeriod = (value: unknown): value is SeededPeriod =>
  typeof value === 'object' && value !== null &&
  Number.isFinite((value as SeededPeriod).startMs) && Number.isFinite((value as SeededPeriod).endMs)

export function parseMonthStartSeed(raw: unknown): MonthStartSeed | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { period, replaced, madeAtMs } = raw as Record<string, unknown>
  if (!isPeriod(period) || !Number.isFinite(madeAtMs)) return null
  if (replaced !== null && !isPeriod(replaced)) return null
  return { period, replaced, madeAtMs: madeAtMs as number }
}
