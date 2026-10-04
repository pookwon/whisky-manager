import { TEXT } from '../../../shared/text.js'
import {
  boardNeedingSearch,
  probeFinished,
  probeSpent,
  probeUnfinished,
  runningStep,
  searchFinished,
  searchUnfinished,
  type CollectionStepInputs,
} from './stepFacts.js'

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
  if (searchUnfinished(inputs.search) || boardNeedingSearch(inputs) !== null) return { badge: 'todo', reason: null }
  if (searchFinished(inputs.search)) return { badge: 'done', reason: null }
  return { badge: 'notNeeded', reason: TEXT.collection.steps.search.notNeeded }
}

export function probeStepState(inputs: CollectionStepInputs): StepState {
  if (runningStep(inputs) === 'probe') return { badge: 'running', reason: null }
  if (probeUnfinished(inputs.probe)) return { badge: 'todo', reason: null }
  if (probeFinished(inputs.probe)) return { badge: 'done', reason: probeSpent(inputs) ? TEXT.collection.steps.probe.spent : null }
  if (searchFinished(inputs.search)) return { badge: 'todo', reason: null }
  return { badge: 'notNeeded', reason: TEXT.collection.steps.probe.notNeeded }
}
