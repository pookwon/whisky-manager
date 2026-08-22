import type { GuardEvaluation } from './guards.js'
import type { ApprovalPolicy, SkipReason } from './types.js'

export type Disposition =
  | { kind: 'EXECUTE' }
  | { kind: 'APPROVE_FIRST' }
  | { kind: 'SKIP'; reason: SkipReason }

/**
 * The three policies differ on one axis only: what to do with a candidate that
 * carries a risk flag. AUTO never calls a human, so it skips rather than queues.
 */
export function decide(policy: ApprovalPolicy, evaluation: GuardEvaluation): Disposition {
  if (evaluation.skip !== null) {
    return { kind: 'SKIP', reason: evaluation.skip }
  }
  if (policy === 'MANUAL') {
    return { kind: 'APPROVE_FIRST' }
  }
  if (evaluation.flags.length === 0) {
    return { kind: 'EXECUTE' }
  }
  return policy === 'AUTO' ? { kind: 'SKIP', reason: 'RISK_FLAGGED' } : { kind: 'APPROVE_FIRST' }
}
