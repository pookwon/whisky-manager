import { isMemberResyncDue } from '../shared/memberResync.js'
import type { MemberRepository } from './collection-db/memberRepository.js'
import type { MemberResyncRepository, MemberResyncState } from './collection-db/memberResyncRepository.js'
import type { CollectionJob } from './collectionJob.js'
import type { MemberCollectionRunner } from './memberCollectionRunner.js'

export interface MemberResyncJobDeps {
  readonly feed: () => MemberRepository | null
  readonly resync: () => MemberResyncRepository | null
  /** The runner bound to the re-walk's own cursor. */
  readonly runner: MemberCollectionRunner
  readonly enabled: () => boolean
  readonly now: () => number
}

/**
 * The periodic re-walk, as one more job the loop takes turns with. It has work
 * while a cycle is under way, and on the first days of a month when no complete
 * pass is from the last week; otherwise it stays out of the rotation. It never runs
 * around the clock — levels drifting for a day longer costs nothing.
 */
export function createMemberResyncJob(deps: MemberResyncJobDeps): CollectionJob {
  let state: MemberResyncState | null = null
  return {
    name: 'memberResync',
    async readProgress() {
      const feed = deps.feed()
      const resync = deps.resync()
      if (feed === null || resync === null) return { exists: false, complete: false, forced: false }
      const [feedState, resyncState] = await Promise.all([feed.readMemberFeedState(), resync.readResyncState()])
      state = resyncState
      const due = isMemberResyncDue(
        {
          enabled: deps.enabled(),
          walkCompletedAtMs: feedState?.completedAtMs ?? null,
          resyncCompletedAtMs: resyncState?.completedAtMs ?? null,
        },
        deps.now(),
      )
      return { exists: resyncState?.inProgress === true || due, complete: false, forced: false }
    },
    start(maxPages) {
      return deps.runner.start({ mode: 'resync', maxPages, resumeFromCheckpoint: state?.inProgress === true })
    },
  }
}
