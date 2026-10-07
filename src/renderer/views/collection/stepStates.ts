import { TEXT } from '../../../shared/text.js'
import { anyBoardBeyondReach, runningStep, type CollectionStepInputs } from './stepFacts.js'

export type StepBadge = 'todo' | 'running' | 'done' | 'notNeeded'

/** A step's badge and, when the badge alone would leave a newcomer asking why, the reason. */
export interface StepState {
  readonly badge: StepBadge
  readonly reason: string | null
}

export function listStepState(inputs: CollectionStepInputs): StepState {
  if (runningStep(inputs) === 'list') return { badge: 'running', reason: null }
  const { job } = inputs.status
  return { badge: job !== null && job.complete ? 'done' : 'todo', reason: null }
}

export function searchStepState(inputs: CollectionStepInputs): StepState {
  if (runningStep(inputs) === 'search') return { badge: 'running', reason: null }
  if (inputs.pipeline.kind === 'search') return { badge: 'todo', reason: null }
  if (!anyBoardBeyondReach(inputs)) return { badge: 'notNeeded', reason: TEXT.collection.steps.search.notNeeded }
  return { badge: inputs.pipeline.kind === 'probe' || inputs.pipeline.kind === 'done' ? 'done' : 'todo', reason: null }
}

export function probeStepState(inputs: CollectionStepInputs): StepState {
  if (runningStep(inputs) === 'probe') return { badge: 'running', reason: null }
  if (inputs.pipeline.kind === 'done') return { badge: 'done', reason: null }
  if (inputs.pipeline.kind === 'probe') return { badge: 'todo', reason: null }
  return { badge: 'notNeeded', reason: TEXT.collection.steps.probe.notNeeded }
}
