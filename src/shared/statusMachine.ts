import type { Disposition } from './policy.js'
import type { ExecutionStatus, Limits } from './types.js'

export type StatusEvent =
  | { type: 'APPROVED' }
  | { type: 'REJECTED' }
  | { type: 'APPROVAL_EXPIRED' }
  | { type: 'EXECUTION_SUCCEEDED' }
  | { type: 'EXECUTION_FAILED'; attempts: number }
  | { type: 'RETRY_DUE' }
  | { type: 'DAILY_CAP_EXCEEDED' }
  | { type: 'KILLED' }

export class InvalidTransitionError extends Error {
  constructor(current: ExecutionStatus, event: StatusEvent['type']) {
    super(`cannot apply ${event} to ${current}`)
    this.name = 'InvalidTransitionError'
  }
}

export function initialStatus(disposition: Disposition): ExecutionStatus {
  switch (disposition.kind) {
    case 'EXECUTE':
      return 'QUEUED'
    case 'APPROVE_FIRST':
      return 'AWAITING_APPROVAL'
    case 'SKIP':
      return 'SKIPPED'
  }
}

export function transition(
  current: ExecutionStatus,
  event: StatusEvent,
  limits: Pick<Limits, 'maxAttempts'>,
): ExecutionStatus {
  if (
    event.type === 'KILLED' &&
    (current === 'AWAITING_APPROVAL' || current === 'QUEUED' || current === 'RETRY_WAIT')
  ) {
    return 'CANCELLED'
  }

  switch (current) {
    case 'AWAITING_APPROVAL':
      if (event.type === 'APPROVED') return 'QUEUED'
      if (event.type === 'REJECTED') return 'SKIPPED'
      if (event.type === 'APPROVAL_EXPIRED') return 'EXPIRED'
      break

    case 'QUEUED':
      if (event.type === 'EXECUTION_SUCCEEDED') return 'SUCCESS'
      if (event.type === 'EXECUTION_FAILED') {
        return event.attempts >= limits.maxAttempts ? 'FAILED' : 'RETRY_WAIT'
      }
      if (event.type === 'DAILY_CAP_EXCEEDED') return 'EXPIRED'
      break

    case 'RETRY_WAIT':
      if (event.type === 'RETRY_DUE') return 'QUEUED'
      if (event.type === 'APPROVAL_EXPIRED') return 'EXPIRED'
      break

    default:
      break
  }

  throw new InvalidTransitionError(current, event.type)
}
