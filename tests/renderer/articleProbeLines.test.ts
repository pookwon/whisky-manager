import { describe, expect, it } from 'vitest'
import {
  articleProbeCreateOutcome,
  articleProbeCreateRefusal,
  articleProbeFailureLine,
  articleProbeProgressLine,
  articleProbeStartLabel,
  articleProbeSummaryLine,
  articleProbeWindowLine,
} from '../../src/renderer/views/collection/articleProbeLines.js'
import type { ArticleProbeJob } from '../../src/desktop/collection-db/articleProbeRepository.js'
import { TEXT } from '../../src/shared/text.js'

const job = (probed: number, otherBoard = 0, notice = 0): ArticleProbeJob => ({ fromDay: '20250101', toDay: '20250829', total: 9660, probed, stored: 684, deleted: 2391, unreadable: 45, otherBoard, notice })
// 2026-09-26 17:47 KST.
const AT = Date.UTC(2026, 8, 26, 8, 47)

describe('article probe wording', () => {
  it('sums the job the way the spec spells it', () => {
    expect(articleProbeSummaryLine(job(3120))).toBe('확인 3,120 / 9,660 · 저장 684 · 삭제 2,391 · 읽기 불가 45')
    // Another board's posts and notices fold into one count: neither is stored.
    expect(articleProbeSummaryLine(job(3120, 7, 2))).toBe('확인 3,120 / 9,660 · 저장 684 · 삭제 2,391 · 읽기 불가 45 · 기타(다른 게시판·공지) 9')
  })

  it('shows a running block\'s ids of its budget', () => {
    expect(articleProbeProgressLine({ requested: 40, maxPages: 60 })).toBe('이번 블록 40 / 60건')
    expect(articleProbeProgressLine(null)).toBeNull()
  })

  it('spells the window as the gap\'s days, ending the day before the search job\'s last day', () => {
    expect(articleProbeWindowLine({ fromDay: '20250101', toDay: '20250829' })).toBe('2025-01-01 ~ 2025-08-28 사이의 빈 id')
    // Across a month end, on the KST calendar.
    expect(articleProbeWindowLine({ fromDay: '20250101', toDay: '20250301' })).toBe('2025-01-01 ~ 2025-02-28 사이의 빈 id')
  })

  it('offers to resume once any id is answered', () => {
    expect(articleProbeStartLabel(job(0))).toBe(TEXT.articleProbe.start)
    expect(articleProbeStartLabel(job(1))).toBe(TEXT.articleProbe.resume)
  })

  it('warns of the block that left no run first, then of a failed last run, and of nothing else', () => {
    const failed = { status: 'failed' as const, stopReason: 'ARTICLE_PROBE_UNKNOWN_ANSWER: id 700001 500 9999', startedAtMs: AT }
    expect(articleProbeFailureLine({ code: 'COLLECTION_FAILURE', stopReason: 'COLLECTION_FAILURE: x', atMs: AT }, failed)).toBe('09-26 17:47 블록이 실행을 남기지 못하고 끝났습니다 · COLLECTION_FAILURE: x')
    expect(articleProbeFailureLine(null, failed)).toBe('09-26 17:47 블록이 멈췄습니다 · ARTICLE_PROBE_UNKNOWN_ANSWER: id 700001 500 9999')
    expect(articleProbeFailureLine(null, { status: 'partial', stopReason: 'PAGE_BUDGET_SPENT', startedAtMs: AT })).toBeNull()
    expect(articleProbeFailureLine(null, null)).toBeNull()
  })

  it('says why no job can be made yet, and nothing once one can', () => {
    expect(articleProbeCreateRefusal({ kind: 'refused', reason: 'SEARCH_NOT_FINISHED' })).toBe(TEXT.articleProbe.refused.SEARCH_NOT_FINISHED)
    expect(articleProbeCreateRefusal({ kind: 'ready', fromDay: '20250101', toDay: '20250829' })).toBeNull()
    expect(articleProbeCreateRefusal(null)).toBeNull()
  })

  it('reads a create press back', () => {
    expect(articleProbeCreateOutcome({ kind: 'ready', idCount: 9660 })).toEqual({ kind: 'created', text: '빈 id 9,660개를 목록에 넣었습니다' })
    expect(articleProbeCreateOutcome({ kind: 'refused', reason: 'JOB_EXISTS' })).toEqual({ kind: 'refusal', text: TEXT.articleProbe.refused.JOB_EXISTS })
  })
})
