/**
 * Pure display logic for the member re-walk card, kept apart from the component
 * so tests can read it without mounting anything.
 */
import { TEXT } from '../../../shared/text.js'
import type { MemberResyncView } from '../../../desktop/memberResyncView.js'
import { formatKstDate, formatKstDateTime } from '../../format.js'
import { progressLine, stopReasonLine } from '../memberCollectionCard.js'

/** Where this cycle is, or how the last one ended. */
export function resyncStateLine(resync: MemberResyncView, totalMemberCount: number | null): string {
  if (!resync.available) return TEXT.memberResync.notYet
  if (resync.inProgress) {
    const progress = progressLine({ pagesStored: resync.pagesStored, totalMemberCount })
    return resync.cycleStartedAtMs === null
      ? progress
      : `${progress} · ${TEXT.memberResync.startedAt(formatKstDateTime(resync.cycleStartedAtMs))}`
  }
  return resync.completedAtMs === null
    ? TEXT.memberResync.never
    : TEXT.memberResync.completedAt(formatKstDateTime(resync.completedAtMs))
}

/** When the next automatic cycle comes, or null while one is under way or none can start. */
export function resyncScheduleLine(resync: MemberResyncView, nowMs: number): string | null {
  if (!resync.available || resync.inProgress) return null
  if (resync.intervalDays === 0) return TEXT.memberResync.off
  if (!resync.scheduleEnabled) return TEXT.memberResync.scheduleOff
  if (resync.nextDueAtMs === null) return null
  return resync.nextDueAtMs <= nowMs
    ? TEXT.memberResync.nextDueNow
    : TEXT.memberResync.nextDue(formatKstDate(resync.nextDueAtMs))
}

/** Why the last re-walk block stopped, worded as the member walk words it; null when there is nothing to say. */
export function resyncStopLine(resync: MemberResyncView): string | null {
  return stopReasonLine({
    running: resync.running,
    lastRunStatus: resync.lastRun?.status ?? null,
    lastRunStopReason: resync.lastRun?.stopReason ?? null,
  })
}
