import { runningStep, type CollectionStepInputs, type WalkStep } from './stepFacts.js'
import type { CollectionPipelineStage } from '../../../desktop/collectionPipelineStage.js'

/** The one thing the top of the screen tells a newcomer to do now. */
export type NextStep =
  | { readonly kind: 'running'; readonly step: WalkStep }
  | { readonly kind: 'resume'; readonly stage: Extract<CollectionPipelineStage, { kind: 'list' | 'search' | 'probe' }>; readonly nextRunAtMs: number | null }
  | { readonly kind: 'pickPeriod' }
  | { readonly kind: 'allDone' }

/**
 * The one thing the top of the screen tells a newcomer to do now: wait for the
 * walk in flight, or carry the pipeline on from its stage, which then goes on
 * to the next stage by itself.
 */
export function nextStep(inputs: CollectionStepInputs, nextRunAtMs: number | null): NextStep {
  const running = runningStep(inputs)
  if (running !== null) return { kind: 'running', step: running }
  const { pipeline } = inputs
  if (pipeline.kind === 'idle') return { kind: 'pickPeriod' }
  if (pipeline.kind === 'done') return { kind: 'allDone' }
  return { kind: 'resume', stage: pipeline, nextRunAtMs }
}
