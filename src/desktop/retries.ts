import { transition } from '../shared/statusMachine.js'
import type { Limits } from '../shared/types.js'
import type { ExecutionsRepo } from './db/executionsRepo.js'

export interface PromoteResult {
  readonly promoted: number
  readonly expired: number
}

/**
 * Runs at the start of each session. A retry whose source post has aged past
 * the backlog limit is dropped rather than promoted — greeting someone days
 * late is worse than not greeting them.
 */
export function promoteRetries(
  repo: ExecutionsRepo,
  automationId: string,
  limits: Limits,
  nowMs: number,
): PromoteResult {
  let promoted = 0
  let expired = 0

  for (const row of repo.listByStatus(automationId, 'RETRY_WAIT')) {
    if (nowMs - row.targetPostedAt > limits.backlogMaxAgeMs) {
      repo.applyPatch(row.id, {
        status: transition('RETRY_WAIT', { type: 'APPROVAL_EXPIRED' }, limits),
        reason: 'STALE_RETRY',
        resolvedAt: nowMs,
      })
      expired += 1
      continue
    }
    repo.applyPatch(row.id, { status: transition('RETRY_WAIT', { type: 'RETRY_DUE' }, limits) })
    promoted += 1
  }

  return { promoted, expired }
}
