/**
 * Pure display-logic functions for the member collection card.
 * Extracted so tests can import and verify them without mounting the component.
 */
import { TEXT } from '../../shared/text.js'
import type { MemberCollectionStatus } from '../../desktop/collection-db/memberStatusQuery.js'

export function progressLine(
  status: Pick<MemberCollectionStatus, 'pagesStored' | 'totalMemberCount'>,
): string {
  const { pagesStored, totalMemberCount } = status
  if (totalMemberCount !== null && totalMemberCount > 0) {
    // Estimated total pages = totalMemberCount / 100 (one page holds ~100 members).
    const percent = Math.min(100, Math.max(0, Math.round((pagesStored / (totalMemberCount / 100)) * 100)))
    return TEXT.memberCollection.progress(percent)
  }
  // No total available: show pages read so the card is never stuck on a
  // placeholder that can never resolve.
  return TEXT.memberCollection.pagesStored(pagesStored)
}

/**
 * Returns the stop-reason line to show below the card, or null when nothing
 * should be shown. Normal reasons (budget, aborted) are worded as progress.
 * Failure reasons are shown for failed runs. A CAS conflict produces a
 * `partial` status: the run repositioned and the walk will continue, so the
 * message says so rather than implying something broke.
 */
export function stopReasonLine(
  status: Pick<MemberCollectionStatus, 'running' | 'lastRunStatus' | 'lastRunStopReason'>,
): string | null {
  const { running, lastRunStatus, lastRunStopReason } = status
  if (running || lastRunStopReason === null) return null
  const normal = new Set(['PAGE_BUDGET_SPENT', 'ABORTED'])
  if (normal.has(lastRunStopReason)) {
    return TEXT.memberCollection.stopReason[lastRunStopReason] ?? TEXT.memberCollection.stopReasonFallback(lastRunStopReason)
  }
  if (lastRunStatus === 'failed' || lastRunStatus === 'partial') {
    return TEXT.memberCollection.stopReason[lastRunStopReason] ?? TEXT.memberCollection.stopReasonFallback(lastRunStopReason)
  }
  return null
}
