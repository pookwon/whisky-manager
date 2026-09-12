import { transition } from '../shared/statusMachine.js'
import type { Limits } from '../shared/types.js'
import type { ExecutionsRepo } from './db/executionsRepo.js'

/**
 * What a press to approve ended as. A refusal is an ordinary answer with a
 * reason the screen can name, not an exception: an unknown row is a wiring
 * fault and still throws, but a row the screening could not render is
 * something the operator is allowed to press and has to be told about.
 */
export type ApproveResult =
  | { readonly kind: 'approved' }
  | { readonly kind: 'refused'; readonly reason: ApprovalRefusal }

export type ApprovalRefusal = 'NO_TEXT'

export function approve(repo: ExecutionsRepo, executionId: string, limits: Limits): ApproveResult {
  const row = repo.getById(executionId)
  if (row === undefined) throw new Error(`unknown execution ${executionId}`)

  // Approving a row with nothing to send queues a comment that can never go
  // out: the backlog walk skips a text-less queued row, a claim reads QUEUED as
  // in progress and never revives it, and no sweep retires it — so it stays
  // unresolved until it ages past two days and stops the automation for good
  // with STALE_BACKLOG. Left awaiting, the existing sweep retires it instead.
  if (row.renderedText === null) return { kind: 'refused', reason: 'NO_TEXT' }

  repo.applyPatch(executionId, { status: transition(row.status, { type: 'APPROVED' }, limits) })
  return { kind: 'approved' }
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
