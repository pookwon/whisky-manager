import { describe, expect, it } from 'vitest'
import {
  SUSPECT_GAP_MIN,
  SUSPECT_LIST_LIMIT,
  summarizeIdGaps,
  type IdGapHistogramRow,
  type IdGapRow,
} from '../../../src/desktop/collection-db/idGapReport.js'

function row(id: number, gap: number, atMs = 1_000): IdGapRow {
  return { id: String(id), nextId: String(id + gap + 1), gap, atMs, nextAtMs: atMs + 60_000 }
}

describe('summarizeIdGaps', () => {
  it('reports an empty table as nothing missing', () => {
    expect(summarizeIdGaps([], [])).toEqual({ deletedLikeIds: 0, suspectCount: 0, suspectIds: 0, suspects: [] })
  })

  it('counts one- and two-wide gaps as deletions, never as suspects', () => {
    const histogram: IdGapHistogramRow[] = [
      { gap: 1, occurrences: 360 },
      { gap: 2, occurrences: 23 },
    ]
    expect(summarizeIdGaps(histogram, [])).toEqual({ deletedLikeIds: 406, suspectCount: 0, suspectIds: 0, suspects: [] })
  })

  it('treats gaps at the threshold and above as suspects and sums their missing ids', () => {
    const histogram: IdGapHistogramRow[] = [
      { gap: 1, occurrences: 4 },
      { gap: SUSPECT_GAP_MIN, occurrences: 2 },
      { gap: 50, occurrences: 1 },
    ]
    const suspects = [row(100, 50), row(200, SUSPECT_GAP_MIN), row(300, SUSPECT_GAP_MIN)]
    const report = summarizeIdGaps(histogram, suspects)
    expect(report.deletedLikeIds).toBe(4)
    expect(report.suspectCount).toBe(3)
    expect(report.suspectIds).toBe(50 + SUSPECT_GAP_MIN * 2)
    expect(report.suspects).toEqual(suspects)
  })

  it('lists the widest gaps first and keeps the list to a screenful', () => {
    const suspects = Array.from({ length: SUSPECT_LIST_LIMIT + 3 }, (_, index) => row(1_000 * (index + 1), 3 + index))
    const report = summarizeIdGaps(
      suspects.map((suspect) => ({ gap: suspect.gap, occurrences: 1 })),
      suspects,
    )
    expect(report.suspects).toHaveLength(SUSPECT_LIST_LIMIT)
    expect(report.suspects[0]?.gap).toBe(3 + SUSPECT_LIST_LIMIT + 2)
    expect(report.suspects.map((suspect) => suspect.gap)).toEqual(
      [...report.suspects.map((suspect) => suspect.gap)].sort((left, right) => right - left),
    )
    expect(report.suspectCount).toBe(SUSPECT_LIST_LIMIT + 3)
  })

  it('breaks a tie on width by showing the newer gap first', () => {
    const older = row(100, 5, 1_000)
    const newer = row(200, 5, 2_000)
    const report = summarizeIdGaps([{ gap: 5, occurrences: 2 }], [older, newer])
    expect(report.suspects).toEqual([newer, older])
  })
})
