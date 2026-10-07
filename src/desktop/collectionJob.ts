import { kstDayStartMs } from '../shared/kst.js'
import type { MemberRepository } from './collection-db/memberRepository.js'
import type { CollectionStartResult } from './collectionRunner.js'
import type { MemberCollectionRunner } from './memberCollectionRunner.js'

export interface CollectionJobProgress {
  readonly exists: boolean
  readonly complete: boolean
  readonly forced: boolean
}

/**
 * One collectable thing, so the loop can round-robin over the collection
 * pipeline and the member walks without knowing either. `startDailyMaintenance`
 * is the member job's daily top-up; the pipeline job has none.
 */
export interface CollectionJob {
  readonly name: 'pipeline' | 'members' | 'memberResync'
  readProgress(): Promise<CollectionJobProgress>
  start(maxPages: number): CollectionStartResult | Promise<CollectionStartResult>
  startDailyMaintenance?(maxPages: number, nowMs: number): Promise<CollectionStartResult | null>
}

export function createMemberCollectionJob(deps: {
  repository: () => MemberRepository | null
  runner: MemberCollectionRunner
}): CollectionJob {
  let complete = false
  let toppedUpAtMs: number | null = null
  return {
    name: 'members',
    async readProgress() {
      const repository = deps.repository()
      const state = repository === null ? null : await repository.readMemberFeedState()
      complete = state?.complete ?? false
      toppedUpAtMs = state?.toppedUpAtMs ?? null
      // A member job "exists" once a walk has begun (a row is present). The
      // status-screen start button creates it; the beat only continues it.
      return { exists: state !== null && !state.complete, complete, forced: state?.forced ?? false }
    },
    start(maxPages) {
      return deps.runner.start({ mode: 'incremental', maxPages, resumeFromCheckpoint: true })
    },
    async startDailyMaintenance(maxPages, nowMs) {
      // Top-up runs once per KST day, only after the walk has completed.
      if (!complete) return null
      if (toppedUpAtMs !== null && kstDayStartMs(toppedUpAtMs) === kstDayStartMs(nowMs)) return null
      return deps.runner.start({ mode: 'topup', maxPages, resumeFromCheckpoint: false })
    },
  }
}
