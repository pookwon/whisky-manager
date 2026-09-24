import { sql } from 'drizzle-orm'
import { kstDayKeyRange, MS_PER_DAY } from '../../shared/kst.js'
import type { CollectionDatabase } from './client.js'
import { posts } from './schema.js'

/** Days after the gap whose id holes stand for "missing anyway". */
const BASELINE_DAYS = 90

export interface IdWindowCounts {
  readonly minId: number | null
  readonly maxId: number | null
  readonly stored: number
}

export interface BoardSearchCoverage {
  /** Article ids between the first and last stored post of the gap window. */
  readonly span: number
  /** Of those, ids with no stored post, cafe-wide. */
  readonly missing: number
  /** The share of ids missing in the complete stretch after the gap; null before there is one. */
  readonly baselineMissingRatio: number | null
  /** Missing ids beyond the baseline — the posts still to recover, roughly. */
  readonly estimatedRemaining: number | null
}

function spanOf(counts: IdWindowCounts): number {
  return counts.minId === null || counts.maxId === null ? 0 : counts.maxId - counts.minId + 1
}

/**
 * Article ids rise one by one across the whole cafe, so the ids of a window
 * that hold no stored post are the posts not collected — plus deleted posts
 * and posts on boards this app never collects. The stretch right after the gap
 * is complete, and its hole rate is taken as that second part.
 */
export function summarizeBoardSearchCoverage(gap: IdWindowCounts, baseline: IdWindowCounts): BoardSearchCoverage {
  const span = spanOf(gap)
  const missing = span - gap.stored
  const baselineSpan = spanOf(baseline)
  if (span === 0 || baselineSpan === 0) return { span, missing: Math.max(0, missing), baselineMissingRatio: null, estimatedRemaining: null }
  const baselineMissingRatio = (baselineSpan - baseline.stored) / baselineSpan
  return { span, missing, baselineMissingRatio, estimatedRemaining: Math.max(0, Math.round(missing - span * baselineMissingRatio)) }
}

export interface BoardSearchCoverageQuery {
  read(window: { readonly fromDay: string; readonly toDay: string }, fingerprint: string): Promise<BoardSearchCoverage>
}

type CountsRow = { readonly min_id: string | null; readonly max_id: string | null; readonly stored: string }

export function createBoardSearchCoverageQuery(db: CollectionDatabase): BoardSearchCoverageQuery {
  let cached: { readonly key: string; readonly coverage: BoardSearchCoverage } | null = null

  async function counts(startMs: number, endMs: number): Promise<IdWindowCounts> {
    const result = await db.execute<CountsRow>(sql`
      select min(${posts.postId}::bigint)::text as min_id, max(${posts.postId}::bigint)::text as max_id, count(*)::text as stored
      from ${posts}
      where ${posts.postedAt} >= ${new Date(startMs)} and ${posts.postedAt} < ${new Date(endMs)}`)
    const row = result.rows[0]
    return {
      minId: row?.min_id == null ? null : Number(row.min_id),
      maxId: row?.max_id == null ? null : Number(row.max_id),
      stored: Number(row?.stored ?? 0),
    }
  }

  return {
    async read(window, fingerprint) {
      const key = `${window.fromDay}-${window.toDay}-${fingerprint}`
      if (cached !== null && cached.key === key) return cached.coverage
      // The gap stops before the window's last day: that day is where the list
      // walk ended, and it is partly stored already.
      const gapStart = kstDayKeyRange(window.fromDay).startMs
      const gapEnd = kstDayKeyRange(window.toDay).startMs
      const baselineStart = kstDayKeyRange(window.toDay).endMs
      const [gap, baseline] = await Promise.all([counts(gapStart, gapEnd), counts(baselineStart, baselineStart + BASELINE_DAYS * MS_PER_DAY)])
      const coverage = summarizeBoardSearchCoverage(gap, baseline)
      cached = { key, coverage }
      return coverage
    },
  }
}
