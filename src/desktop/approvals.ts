import { transition } from '../shared/statusMachine.js'
import type { Limits } from '../shared/types.js'
import type { ExecutionsRepo } from './db/executionsRepo.js'

export function approve(repo: ExecutionsRepo, executionId: string, limits: Limits): void {
  const row = repo.getById(executionId)
  if (row === undefined) throw new Error(`unknown execution ${executionId}`)
  repo.applyPatch(executionId, { status: transition(row.status, { type: 'APPROVED' }, limits) })
}

export function reject(repo: ExecutionsRepo, executionId: string, nowMs: number): void {
  const row = repo.getById(executionId)
  if (row === undefined) throw new Error(`unknown execution ${executionId}`)
  repo.applyPatch(executionId, {
    status: transition(row.status, { type: 'REJECTED' }, { maxAttempts: 0 }),
    reason: 'REJECTED_BY_OPERATOR',
    resolvedAt: nowMs,
  })
}

export interface SweepResult {
  readonly expired: number
}

/**
 * Approval requests go stale. A greeting approved two days after signup reads
 * worse than none, so the queue drops them instead of growing without bound.
 */
export function sweepApprovals(
  repo: ExecutionsRepo,
  automationId: string,
  limits: Limits,
  nowMs: number,
): SweepResult {
  let expired = 0

  for (const row of repo.listByStatus(automationId, 'AWAITING_APPROVAL')) {
    if (nowMs - row.detectedAt <= limits.approvalTtlMs) continue
    repo.applyPatch(row.id, {
      status: transition('AWAITING_APPROVAL', { type: 'APPROVAL_EXPIRED' }, limits),
      reason: 'APPROVAL_TIMEOUT',
      resolvedAt: nowMs,
    })
    expired += 1
  }

  return { expired }
}
