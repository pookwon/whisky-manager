import { TEXT } from '../../../shared/text.js'
import type { BoardSearchCoverage } from '../../../desktop/collection-db/boardSearchCoverageQuery.js'
import type { BoardSearchJobView, BoardSearchQueryView } from '../../../desktop/boardSearchView.js'
import type { BoardSearchPlanView } from '../../../desktop/ipc.js'

/** What a preview or create press answered: a plan to read, or a refusal to fix. */
export interface BoardSearchPlanOutcome {
  readonly kind: 'plan' | 'refusal'
  readonly text: string
}

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
  return TEXT.boardSearch.coverage(coverage.span, coverage.missing, coverage.baselineMissingRatio, coverage.estimatedRemaining)
}

export function boardSearchPlanOutcome(plan: BoardSearchPlanView, fromDay: string): BoardSearchPlanOutcome {
  return plan.kind === 'ready'
    ? { kind: 'plan', text: TEXT.boardSearch.preview(plan.queryCount, dayKeyLabel(fromDay), dayKeyLabel(plan.toDay)) }
    : { kind: 'refusal', text: TEXT.boardSearch.refused[plan.reason] }
}

/** Resume once any query has a stored page; until then the job has not started. */
export function boardSearchStartLabel(job: BoardSearchJobView): string {
  return job.queries.some((query) => query.lastCommittedPage !== null) ? TEXT.boardSearch.resume : TEXT.boardSearch.start
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
