/**
 * Telling a lost list page from ordinary deletions, after the fact.
 *
 * Article ids in the cafe are dense and rise with time. A post the author
 * removed leaves a hole of one or two ids; a page the walk never stored leaves
 * a hole of about fifty. Nothing in flight guards the deep, out-of-order pages
 * (see `assertPage` in the orchestrator), so this is the check that says whether
 * anything was lost — and it answers the question the cafe's own statistics
 * raise, which count every post ever written, deleted ones included.
 */

/** One hole between two stored neighbours. Ids stay strings, as the rows keep them. */
export interface IdGapRow {
  readonly id: string
  readonly nextId: string
  /** How many ids are missing between the two. */
  readonly gap: number
  readonly atMs: number
  readonly nextAtMs: number
}

export interface IdGapHistogramRow {
  readonly gap: number
  readonly occurrences: number
}

export interface IdGapReport {
  /** Ids missing in holes too narrow to be anything but deletions. */
  readonly deletedLikeIds: number
  /** Holes wide enough to look at, however many there are — not just the listed ones. */
  readonly suspectCount: number
  /** Ids missing across all suspect holes. */
  readonly suspectIds: number
  /** The widest suspects, newest first among equals; a screenful, not all. */
  readonly suspects: readonly IdGapRow[]
}

/**
 * Three, by the operator's choice: measured over eight months the widest hole
 * was seven and every one of those sat inside a burst of spam removals, so a
 * three-wide hole is rare enough to be worth a glance and a fifty-wide one can
 * never hide behind the threshold.
 */
export const SUSPECT_GAP_MIN = 3

export const SUSPECT_LIST_LIMIT = 5

export const EMPTY_ID_GAP_REPORT: IdGapReport = { deletedLikeIds: 0, suspectCount: 0, suspectIds: 0, suspects: [] }

function widestNewestFirst(left: IdGapRow, right: IdGapRow): number {
  return right.gap - left.gap || right.atMs - left.atMs
}

/**
 * `suspects` may already be the widest few — the query stops at the list
 * limit — so the counts come from the histogram, which sees every hole.
 */
export function summarizeIdGaps(histogram: readonly IdGapHistogramRow[], suspects: readonly IdGapRow[]): IdGapReport {
  const deletions = histogram.filter((row) => row.gap < SUSPECT_GAP_MIN)
  const wide = histogram.filter((row) => row.gap >= SUSPECT_GAP_MIN)
  const missingIds = (rows: readonly IdGapHistogramRow[]): number => rows.reduce((sum, row) => sum + row.gap * row.occurrences, 0)
  return {
    deletedLikeIds: missingIds(deletions),
    suspectCount: wide.reduce((sum, row) => sum + row.occurrences, 0),
    suspectIds: missingIds(wide),
    suspects: [...suspects].sort(widestNewestFirst).slice(0, SUSPECT_LIST_LIMIT),
  }
}
