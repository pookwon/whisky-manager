import type { ArticleProbeView } from '../../../desktop/articleProbeView.js'
import type { BoardSearchView } from '../../../desktop/boardSearchView.js'
import type { CollectionStatus } from '../../../desktop/collection-db/statusQuery.js'
import type { CollectionPipelineStage } from '../../../desktop/collectionPipelineStage.js'

/** The three walks the loop takes turns with, in the order a collection goes. */
export type WalkStep = 'list' | 'search' | 'probe'

/**
 * What the step logic reads: the list status, the two later walks' views when
 * their storage answered, and where the pipeline stands. A walk whose view is
 * not ready counts as no walk at all, so the screen degrades to fewer steps
 * rather than to an error.
 */
export interface CollectionStepInputs {
  readonly status: CollectionStatus
  readonly search: BoardSearchView | null
  readonly probe: ArticleProbeView | null
  /** Where the pipeline stands; the walks run in its order, so the screen reads it rather than working the order out again. */
  readonly pipeline: CollectionPipelineStage
}

/** The walks share one lock, so at most one of these is ever true. */
export function runningStep({ status, search, probe }: CollectionStepInputs): WalkStep | null {
  if (status.running !== null) return 'list'
  if (search?.running === true) return 'search'
  if (probe?.running === true) return 'probe'
  return null
}

/** Whether any board of the job ran out of list before the period did. */
export function anyBoardBeyondReach({ status }: CollectionStepInputs): boolean {
  return (status.job?.boards ?? []).some((board) => board.state === 'horizon')
}
