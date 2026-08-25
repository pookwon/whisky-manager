import { kstDayRange } from '../shared/kst.js'
import { TIMEOUTS, type RawCandidate, type SourceRef } from '../shared/protocol.js'
import type { ExtensionTransport } from './ws/server.js'

export interface DayCollectionDeps {
  readonly transport: ExtensionTransport
  readonly automationId: string
  readonly source: SourceRef
  readonly newRequestId: () => string
  /** Any moment inside the day to read. Normalised to that day in KST. */
  readonly dayStartMs: number
  /** Reports paging as it happens. Nothing about the read depends on a listener. */
  readonly onProgress?: (pagesRead: number, collected: number) => void
}

/**
 * The day's posts, and only the day's.
 *
 * The trim belongs here rather than at each call site. Collection takes a floor
 * and no ceiling, so asking for an earlier day brings back everything written
 * since — and whichever posts are left in the set decide who counts as an
 * author's first. A caller that forgot to trim would answer a different person
 * than the run that follows it, which is exactly the drift this function exists
 * to make impossible. The count and the run reach the board through one door.
 *
 * `null` means the read failed. That is not the same as a day with no posts,
 * and the two must never collapse into one another: an empty day is a session
 * with nothing to do, a failed read is a session that must not start.
 */
export async function collectDay(deps: DayCollectionDeps): Promise<RawCandidate[] | null> {
  const day = kstDayRange(deps.dayStartMs)

  try {
    const reply = await deps.transport.request(
      {
        type: 'COLLECT',
        requestId: deps.newRequestId(),
        automationId: deps.automationId,
        source: deps.source,
        sincePostedAt: day.startMs,
      },
      TIMEOUTS.collectMs,
      (interim) => {
        if (interim.type === 'COLLECT_PROGRESS') {
          deps.onProgress?.(interim.pagesRead, interim.collected)
        }
      },
    )
    if (reply.type !== 'COLLECTED') return null
    return reply.candidates.filter((raw) => raw.postedAt < day.endMs)
  } catch {
    return null
  }
}
