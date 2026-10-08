import { describe, expect, it } from 'vitest'
import {
  articleProbeBreakdownLine,
  articleProbeFailureLine,
  articleProbeHeadlineLine,
  articleProbeProgressLine,
  articleProbeWindowLine,
} from '../../src/renderer/views/collection/articleProbeLines.js'
import type { ArticleProbeJob } from '../../src/desktop/collection-db/articleProbeRepository.js'

const job = (probed: number, otherBoard = 0, notice = 0): ArticleProbeJob => ({ fromDay: '20250101', toDay: '20250829', total: 9660, probed, stored: 684, deleted: 2391, unreadable: 45, otherBoard, notice })
// 2026-09-26 17:47 KST.
const AT = Date.UTC(2026, 8, 26, 8, 47)

describe('article probe wording', () => {
  it('shows a running block\'s ids of its budget', () => {
    expect(articleProbeProgressLine({ requested: 40, maxPages: 60 })).toBe('이번 차례 40 / 60건')
    expect(articleProbeProgressLine(null)).toBeNull()
  })

  it('spells the window as the gap\'s days, ending the day before the search job\'s last day', () => {
    expect(articleProbeWindowLine({ fromDay: '20250101', toDay: '20250829' })).toBe('2025-01-01 ~ 2025-08-28 사이의 빈 글 번호')
    // Across a month end, on the KST calendar.
    expect(articleProbeWindowLine({ fromDay: '20250101', toDay: '20250301' })).toBe('2025-01-01 ~ 2025-02-28 사이의 빈 글 번호')
  })

  it('warns of the block that left no run first, then of a failed last run, and of nothing else', () => {
    const failed = { status: 'failed' as const, stopReason: 'ARTICLE_PROBE_UNKNOWN_ANSWER: id 700001 500 9999', startedAtMs: AT }
    expect(articleProbeFailureLine({ code: 'COLLECTION_FAILURE', stopReason: 'COLLECTION_FAILURE: x', atMs: AT }, failed)).toBe('09-26 17:47 차례가 실행을 남기지 못하고 끝났습니다 · 수집 중 오류가 발생했습니다 (COLLECTION_FAILURE: x)')
    expect(articleProbeFailureLine(null, failed)).toBe('09-26 17:47 차례가 멈췄습니다 · 글 번호 확인 응답을 판단하지 못했습니다 (ARTICLE_PROBE_UNKNOWN_ANSWER: id 700001 500 9999)')
    expect(articleProbeFailureLine(null, { status: 'failed', stopReason: 'NEW_CODE', startedAtMs: AT })).toBe('09-26 17:47 차례가 멈췄습니다 · NEW_CODE')
    expect(articleProbeFailureLine(null, { status: 'partial', stopReason: 'PAGE_BUDGET_SPENT', startedAtMs: AT })).toBeNull()
    expect(articleProbeFailureLine(null, null)).toBeNull()
  })

  it('splits the job into the line a glance wants and the breakdown kept below the fold', () => {
    expect(articleProbeHeadlineLine(job(3120))).toBe('확인 3,120 / 9,660 · 저장 684건')
    expect(articleProbeBreakdownLine(job(3120))).toBe('삭제 2,391 · 읽기 불가 45')
    expect(articleProbeBreakdownLine(job(3120, 7, 2))).toBe('삭제 2,391 · 읽기 불가 45 · 기타(다른 게시판·공지) 9')
  })
})
