import { CAFE_BOARD_SEARCH } from '../../../shared/cafeBoardSearchEndpoint.js'
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchCoverage } from '../../../desktop/collection-db/boardSearchCoverageQuery.js'
import type { BoardSearchBlockFailure, BoardSearchProgress } from '../../../desktop/boardSearchRunner.js'
import type { BoardSearchJobView, BoardSearchQueryView } from '../../../desktop/boardSearchView.js'
import { formatKstDateTime } from '../../format.js'

const DAY_KEY = /^(\d{4})(\d{2})(\d{2})$/

/** `20250101` → `2025-01-01`, which is how the date inputs and the other cards spell a day. */
export function dayKeyLabel(key: string): string {
  return key.replace(DAY_KEY, '$1-$2-$3')
}

/** `20250105` → `01-05`: a day within the job's window, whose year the window already says. */
function dayKeyMonthDay(key: string): string {
  return key.replace(DAY_KEY, '$2-$3')
}

/** A date input's `2025-01-01` → the search's `20250101`. The input already speaks the KST calendar. */
export function dayKeyOfDateInput(value: string): string {
  return value.replaceAll('-', '')
}

export function boardSearchSummaryLine(job: BoardSearchJobView): string {
  return TEXT.boardSearch.summary(job.completedCount, job.queries.length, job.insertedTotal, job.current)
}

export function boardSearchCoverageLine(coverage: BoardSearchCoverage): string | null {
  if (coverage.estimatedRemaining === null || coverage.baselineMissingRatio === null) return null
  return TEXT.boardSearch.coverage(coverage.span, coverage.missing, coverage.baselineMissingRatio, coverage.estimatedRemaining)
}

/** Resume once any query has a stored page or a narrowed window; until then the job has not started. */
export function boardSearchStartLabel(job: BoardSearchJobView): string {
  return job.queries.some((query) => query.lastCommittedPage !== null || query.segmentToDay !== null) ? TEXT.boardSearch.resume : TEXT.boardSearch.start
}

export type BoardSearchQueryStateKind = 'done' | 'walking' | 'waiting' | 'failed'

/**
 * Read from the query's own newest run, not from the job's first unfinished
 * query: a query's own failure moves the block on to the next one, and the
 * failed query stays first until a later block walks it again.
 */
export function boardSearchQueryState(query: BoardSearchQueryView, running: boolean): BoardSearchQueryStateKind {
  if (query.complete) return 'done'
  if (running && query.lastRun?.status === 'running') return 'walking'
  return query.lastRun?.status === 'failed' ? 'failed' : 'waiting'
}

/** A failed row carries its stop reason, so why it failed is on the screen and not only in the database. */
export function boardSearchQueryStateText(query: BoardSearchQueryView, state: BoardSearchQueryStateKind): string {
  const reason = state === 'failed' ? (query.lastRun?.stopReason ?? null) : null
  return reason === null ? TEXT.boardSearch.states[state] : TEXT.boardSearch.failedWith(reason)
}

export function boardSearchProgressLine(progress: BoardSearchProgress | null): string | null {
  return progress === null ? null : TEXT.boardSearch.progress(progress.requestedPages, progress.maxPages, progress.query)
}

/**
 * A block whose failure no query row shows: without this line the start
 * button would come back as if nothing had been pressed.
 */
export function boardSearchBlockFailureLine(failure: BoardSearchBlockFailure | null): string | null {
  return failure === null ? null : TEXT.boardSearch.blockFailed(formatKstDateTime(failure.atMs), failure.stopReason)
}

/** The search's own total, read as "at least" once it reaches the count it stops at. */
export function boardSearchTotalLabel(total: number | null): string {
  if (total === null) return '—'
  return total >= CAFE_BOARD_SEARCH.totalCountCap ? TEXT.boardSearch.totalAtLeast(total) : total.toLocaleString('ko-KR')
}

/** The stored page, with the end of the narrower window once the query walks one. */
export function boardSearchPageLabel(query: BoardSearchQueryView): string {
  const page = query.lastCommittedPage === null ? '—' : String(query.lastCommittedPage)
  return query.segmentToDay === null ? page : TEXT.boardSearch.pageInSegment(page, dayKeyMonthDay(query.segmentToDay))
}

/** The figure a newcomer acts on; null until there is a baseline to subtract. */
export function boardSearchRemainingLine(coverage: BoardSearchCoverage): string | null {
  return coverage.estimatedRemaining === null ? null : TEXT.boardSearch.remaining(coverage.estimatedRemaining)
}
