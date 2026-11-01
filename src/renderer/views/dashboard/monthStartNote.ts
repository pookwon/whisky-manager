import { TEXT } from '../../../shared/text.js'
import type { MonthStartSeed } from '../../../shared/monthStartSeed.js'
import { formatKstDate } from '../../format.js'

const named = (period: { readonly startMs: number; readonly endMs: number }): readonly [string, string] =>
  // The end is the midnight after the last day, so naming it directly would announce a day outside the period.
  [formatKstDate(period.startMs), formatKstDate(period.endMs - 1)]

/**
 * What to say about a job the month start made, while it is the job on show.
 * A job the operator has since chosen is theirs, and gets no note.
 */
export function monthStartNote(
  seed: MonthStartSeed | null,
  job: { readonly targetStartMs: number; readonly targetEndMs: number } | null,
): readonly string[] {
  if (seed === null || job === null) return []
  if (job.targetStartMs !== seed.period.startMs || job.targetEndMs !== seed.period.endMs) return []
  const lines = [TEXT.dashboard.monthStartMade(...named(seed.period))]
  if (seed.replaced !== null) lines.push(TEXT.dashboard.monthStartReplaced(...named(seed.replaced)))
  return lines
}
