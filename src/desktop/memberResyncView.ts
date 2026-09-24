import { nextMemberResyncDueMs, type MemberResyncIntervalDays } from '../shared/memberResync.js'
import type { MemberRepository } from './collection-db/memberRepository.js'
import type { MemberResyncLastRun, MemberResyncRepository } from './collection-db/memberResyncRepository.js'

/** What the member screen shows about the periodic re-walk. */
export interface MemberResyncView {
  readonly intervalDays: MemberResyncIntervalDays
  /** False until the first full walk has finished: there is nothing to walk again yet. */
  readonly available: boolean
  readonly inProgress: boolean
  /** A re-walk block is reading right now — not the top-up, which shares the list. */
  readonly running: boolean
  /** Automatic blocks only start while the collection schedule is on. */
  readonly scheduleEnabled: boolean
  readonly lastRun: MemberResyncLastRun | null
  /** Pages this cycle has reached; zero before it has committed one. */
  readonly pagesStored: number
  readonly cycleStartedAtMs: number | null
  readonly completedAtMs: number | null
  /** When the next automatic cycle is due; null when it is off or not yet possible. */
  readonly nextDueAtMs: number | null
}

export interface MemberResyncViewInputs {
  readonly feed: MemberRepository
  readonly resync: MemberResyncRepository
  readonly intervalDays: MemberResyncIntervalDays
  readonly running: boolean
  readonly scheduleEnabled: boolean
}

export async function readMemberResyncView(inputs: MemberResyncViewInputs): Promise<MemberResyncView> {
  const { feed, resync, intervalDays } = inputs
  const [feedState, resyncState, lastRun] = await Promise.all([feed.readMemberFeedState(), resync.readResyncState(), resync.readLastRun()])
  const inProgress = resyncState?.inProgress === true
  return {
    intervalDays,
    available: feedState?.complete === true,
    inProgress,
    running: inputs.running,
    scheduleEnabled: inputs.scheduleEnabled,
    lastRun,
    pagesStored: inProgress ? (resyncState?.referencePage ?? 0) : 0,
    cycleStartedAtMs: resyncState?.cycleStartedAtMs ?? null,
    completedAtMs: resyncState?.completedAtMs ?? null,
    nextDueAtMs: nextMemberResyncDueMs({
      intervalDays,
      walkCompletedAtMs: feedState?.completedAtMs ?? null,
      resyncCompletedAtMs: resyncState?.completedAtMs ?? null,
    }),
  }
}
