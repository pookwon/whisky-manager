import { TEXT } from '../../../shared/text.js'
import type { BoardSearchQueryState } from '../../../desktop/collection-db/boardSearchRepository.js'
import type { BoardSearchCoverage } from '../../../desktop/collection-db/boardSearchCoverageQuery.js'
import type { BoardSearchJobView } from '../../../desktop/boardSearchView.js'

const DAY_KEY = /^(\d{4})(\d{2})(\d{2})$/

/** `20250101` → `2025-01-01`, which is how the date inputs and the other cards spell a day. */
export function dayKeyLabel(key: string): string {
  return key.replace(DAY_KEY, '$1-$2-$3')
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
  return TEXT.boardSearch.coverage(coverage.estimatedRemaining, coverage.baselineMissingRatio)
}

export function boardSearchQueryState(query: BoardSearchQueryState, current: string | null, running: boolean): 'done' | 'walking' | 'waiting' {
  if (query.complete) return 'done'
  return running && query.query === current ? 'walking' : 'waiting'
}
