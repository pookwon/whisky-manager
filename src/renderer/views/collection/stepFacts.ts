import type { ArticleProbeView } from '../../../desktop/articleProbeView.js'
import type { BoardSearchView } from '../../../desktop/boardSearchView.js'
import type { BoardProgress, CollectionStatus } from '../../../desktop/collection-db/statusQuery.js'

/** The three walks the loop takes turns with, in the order a collection goes. */
export type WalkStep = 'list' | 'search' | 'probe'

/**
 * What the step logic reads: the list status, and the two later walks' views
 * when their storage answered. A walk whose view is not ready counts as no
 * walk at all, so the screen degrades to fewer steps rather than to an error.
 */
export interface CollectionStepInputs {
  readonly status: CollectionStatus
  readonly search: BoardSearchView | null
  readonly probe: ArticleProbeView | null
}

/** The walks share one lock, so at most one of these is ever true. */
export function runningStep({ status, search, probe }: CollectionStepInputs): WalkStep | null {
  if (status.running !== null) return 'list'
  if (search?.running === true) return 'search'
  if (probe?.running === true) return 'probe'
  return null
}

export function listUnfinished(status: CollectionStatus): boolean {
  return status.job !== null && !status.job.complete
}

export function searchUnfinished(search: BoardSearchView | null): boolean {
  return search !== null && search.job !== null && search.job.current !== null
}

export function searchFinished(search: BoardSearchView | null): boolean {
  return search !== null && search.job !== null && search.job.current === null
}

export function probeUnfinished(probe: ArticleProbeView | null): boolean {
  return probe !== null && probe.job !== null && probe.job.probed < probe.job.total
}

export function probeFinished(probe: ArticleProbeView | null): boolean {
  return probe !== null && probe.job !== null && probe.job.probed >= probe.job.total
}

/**
 * The first board, in walking order, whose list ran out before the period did
 * and that the search job is not already for. That board's older posts are
 * reachable only by searching its titles — and only when the search storage
 * answered, since otherwise there is no search step on screen to go to.
 */
export function boardNeedingSearch({ status, search }: CollectionStepInputs): BoardProgress | null {
  if (search === null) return null
  const searchedBoardId = search.job?.boardId ?? null
  const boards = [...(status.job?.boards ?? [])].sort((a, b) => a.queueOrder - b.queueOrder)
  return boards.find((board) => board.state === 'horizon' && board.boardId !== searchedBoardId) ?? null
}

/**
 * The probe job was made once, for an earlier search window, and the
 * repository refuses a second one: the finished search in hand cannot be
 * followed by a probe of its own.
 */
export function probeSpent({ search, probe }: CollectionStepInputs): boolean {
  const searchJob = search?.job ?? null
  const probeJob = probe?.job ?? null
  if (searchJob === null || probeJob === null) return false
  if (searchJob.current !== null || probeJob.probed < probeJob.total) return false
  return searchJob.fromDay !== probeJob.fromDay || searchJob.toDay !== probeJob.toDay
}
