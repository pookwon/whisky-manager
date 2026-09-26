import { describe, expect, it } from 'vitest'
import {
  boardSearchBlockFailureLine,
  boardSearchCoverageLine,
  boardSearchPageLabel,
  boardSearchPlanOutcome,
  boardSearchProgressLine,
  boardSearchQueryState,
  boardSearchQueryStateText,
  boardSearchStartLabel,
  boardSearchSummaryLine,
  boardSearchTotalLabel,
  dayKeyLabel,
  dayKeyOfDateInput,
} from '../../src/renderer/views/collection/boardSearchLines.js'
import type { BoardSearchJobView, BoardSearchQueryView } from '../../src/desktop/boardSearchView.js'
import type { BoardSearchLastRun } from '../../src/desktop/collection-db/boardSearchLastRunQuery.js'
import { TEXT } from '../../src/shared/text.js'

const query = (q: string, complete: boolean, lastRun: BoardSearchLastRun | null = null): BoardSearchQueryView => ({
  boardId: '137', query: q, fromDay: '20250101', toDay: '20250829', segmentToDay: null, queueOrder: 1, expectedGain: 1, lastCommittedPage: null, insertedCount: 0, totalCount: null, complete, lastRunId: null, lastRun,
})

const job = (queries: readonly BoardSearchQueryView[]): BoardSearchJobView => ({
  boardId: '137', boardName: '국내구입기 & 정보', fromDay: '20250101', toDay: '20250829',
  queries, completedCount: 0, insertedTotal: 0, current: queries[0]?.query ?? null,
  coverage: { span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null },
})

describe('board search wording', () => {
  it('spells day keys the way the screens spell dates', () => {
    expect(dayKeyLabel('20250101')).toBe('2025-01-01')
    expect(dayKeyOfDateInput('2025-01-01')).toBe('20250101')
  })

  it('sums a job in one line', () => {
    const line = boardSearchSummaryLine({
      boardId: '137', boardName: '국내구입기 & 정보', fromDay: '20250101', toDay: '20250829',
      queries: [query('글렌', true), query('구매', false)], completedCount: 1, insertedTotal: 1234, current: '구매',
      coverage: { span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null },
    })
    expect(line).toContain('1 / 2')
    expect(line).toContain('1,234')
    expect(line).toContain('구매')
  })

  it('shows the residual only when it can be estimated', () => {
    expect(boardSearchCoverageLine({ span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null })).toBeNull()
    expect(boardSearchCoverageLine({ span: 111_973, missing: 41_545, baselineMissingRatio: 0.067, estimatedRemaining: 34_043 })).toBe(
      '빈 구간 id 111,973개 중 비어 있는 것 41,545개. 기준선 6.7%(삭제·비수집 게시판)를 빼면 아직 못 거둔 글 약 34,043건',
    )
  })

  it('tells a plan from a refusal', () => {
    expect(boardSearchPlanOutcome({ kind: 'ready', toDay: '20250829', queryCount: 300 }, '20250101')).toEqual({
      kind: 'plan',
      text: '검색어 300개 · 2025-01-01 ~ 2025-08-29',
    })
    expect(boardSearchPlanOutcome({ kind: 'refused', reason: 'NOTHING_BEFORE' }, '20250101')).toEqual({
      kind: 'refusal',
      text: TEXT.boardSearch.refused.NOTHING_BEFORE,
    })
  })

  it('offers to resume once any query has a stored page', () => {
    expect(boardSearchStartLabel(job([query('글렌', false), query('구매', false)]))).toBe(TEXT.boardSearch.start)
    expect(boardSearchStartLabel(job([query('글렌', true), query('구매', false)]))).toBe(TEXT.boardSearch.start)
    expect(boardSearchStartLabel(job([{ ...query('글렌', false), lastCommittedPage: 3 }, query('구매', false)]))).toBe(TEXT.boardSearch.resume)
    // Just narrowed: the narrower window has no stored page yet, but the query has been walked.
    expect(boardSearchStartLabel(job([{ ...query('글렌', false), segmentToDay: '20250105' }, query('구매', false)]))).toBe(TEXT.boardSearch.resume)
  })

  it('tells a finished, walking and waiting query apart', () => {
    const walking = { status: 'running', stopReason: null } as const
    expect(boardSearchQueryState(query('글렌', true), true)).toBe('done')
    expect(boardSearchQueryState(query('구매', false, walking), true)).toBe('walking')
    expect(boardSearchQueryState(query('구매', false), false)).toBe('waiting')
    expect(boardSearchQueryState(query('이마트', false), true)).toBe('waiting')
  })

  it('marks a query whose last run failed, until it is walked again', () => {
    const failed = { status: 'failed', stopReason: 'BOARD_SEARCH_OUT_OF_WINDOW' } as const
    // A query's own failure moves the block on while the failed query is still
    // the first unfinished one: the row stays failed while the next one walks.
    expect(boardSearchQueryState(query('글렌', false, failed), true)).toBe('failed')
    expect(boardSearchQueryState(query('글렌', false, failed), false)).toBe('failed')
    expect(boardSearchQueryState(query('글렌', true, failed), false)).toBe('done')
    expect(boardSearchQueryState(query('글렌', false, { status: 'partial', stopReason: 'PAGE_BUDGET_SPENT' }), false)).toBe('waiting')
  })

  it('says why a failed query stopped', () => {
    const failed = query('글렌', false, { status: 'failed', stopReason: 'BOARD_SEARCH_HTTP_ERROR' })
    expect(boardSearchQueryStateText(failed, 'failed')).toBe(TEXT.boardSearch.failedWith('BOARD_SEARCH_HTTP_ERROR'))
    expect(TEXT.boardSearch.failedWith('BOARD_SEARCH_HTTP_ERROR')).toContain('BOARD_SEARCH_HTTP_ERROR')
    expect(boardSearchQueryStateText(query('글렌', false, { status: 'failed', stopReason: null }), 'failed')).toBe(TEXT.boardSearch.states.failed)
    // A partial run's reason is the budget, not a fault; the row does not repeat it.
    expect(boardSearchQueryStateText(query('글렌', false, { status: 'partial', stopReason: 'PAGE_BUDGET_SPENT' }), 'waiting')).toBe(TEXT.boardSearch.states.waiting)
  })

  it('shows the search total as a floor once it reaches the cap the search reports', () => {
    // "글렌" reported 2,000 while its pages held 3,369 posts (2026-09-25).
    expect(boardSearchTotalLabel(null)).toBe('—')
    expect(boardSearchTotalLabel(578)).toBe('578')
    expect(boardSearchTotalLabel(1999)).toBe('1,999')
    expect(boardSearchTotalLabel(2000)).toBe(TEXT.boardSearch.totalAtLeast(2000))
  })

  it('shows a narrowed query\'s page with the end of the window it is walking', () => {
    expect(boardSearchPageLabel(query('글렌', false))).toBe('—')
    expect(boardSearchPageLabel({ ...query('글렌', false), lastCommittedPage: 12 })).toBe('12')
    expect(boardSearchPageLabel({ ...query('구매', false), lastCommittedPage: 12, segmentToDay: '20250105' })).toBe(TEXT.boardSearch.pageInSegment('12', '01-05'))
    expect(TEXT.boardSearch.pageInSegment('12', '01-05')).toBe('12 · ~01-05')
    // Just narrowed: the narrower window has no stored page yet.
    expect(boardSearchPageLabel({ ...query('구매', false), segmentToDay: '20250105' })).toBe(TEXT.boardSearch.pageInSegment('—', '01-05'))
  })

  it('says when and why the last block failed with no run row to say it, and nothing without one', () => {
    // 2026-09-26 03:06:32 KST.
    const atMs = Date.UTC(2026, 8, 25, 18, 6, 32)
    const stopReason = 'COLLECTION_FAILURE: error: duplicate key value violates unique constraint "runs_one_running_feed"'
    expect(boardSearchBlockFailureLine({ code: 'COLLECTION_FAILURE', stopReason, atMs })).toBe(TEXT.boardSearch.blockFailed('09-26 03:06', stopReason))
    expect(boardSearchBlockFailureLine(null)).toBeNull()
  })

  it('reads a running block\'s progress as pages of its budget and the query in hand, and nothing before it has one', () => {
    expect(boardSearchProgressLine({ query: '알라키', requestedPages: 12, maxPages: 60 })).toBe(TEXT.boardSearch.progress(12, 60, '알라키'))
    expect(TEXT.boardSearch.progress(12, 60, '알라키')).toBe("이번 블록 12 / 60쪽 · '알라키'")
    expect(boardSearchProgressLine(null)).toBeNull()
  })
})
