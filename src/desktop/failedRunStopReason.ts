import { describeFailure } from './collectionFailure.js'
import { CollectionPageError } from './collectionOrchestrator.js'

export interface FailedRunStopReason {
  /** Bare, for callers that match on it. */
  readonly code: string
  /** What the run row keeps, so the run list itself explains the failure. */
  readonly stopReason: string
}

/**
 * The code and stop reason a walk writes when a run fails. Every walk that
 * leaves a run row derives them here, so one failure reads the same in the run
 * list whichever walk hit it.
 */
export function failedRunStopReason(error: unknown): FailedRunStopReason {
  if (error instanceof CollectionPageError) {
    return { code: error.code, stopReason: error.detail === undefined ? error.code : `${error.code}: ${error.detail}` }
  }
  return { code: 'COLLECTION_FAILURE', stopReason: `COLLECTION_FAILURE: ${describeFailure(error)}` }
}
