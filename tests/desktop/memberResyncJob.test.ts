import { describe, expect, it } from 'vitest'
import { createMemberResyncJob } from '../../src/desktop/memberResyncJob.js'
import type { MemberFeedState, MemberRepository } from '../../src/desktop/collection-db/memberRepository.js'
import type { MemberResyncRepository, MemberResyncState } from '../../src/desktop/collection-db/memberResyncRepository.js'
import type { MemberCollectionStartRequest } from '../../src/desktop/memberCollectionRunner.js'
import type { MemberResyncIntervalDays } from '../../src/shared/memberResync.js'

const DAY = 86_400_000
/** 2026-09-15 12:00 KST. */
const WALK_DONE = Date.UTC(2026, 8, 15, 3)

function feedState(completedAtMs: number | null): MemberFeedState {
  return {
    stateVersion: 3, anchorMemberKey: null, anchorJoinDate: null, referencePage: 1, pageIdentity: null,
    totalMemberCount: 209_000, cursorUpdatedAtMs: 0,
    complete: completedAtMs !== null, completedAtMs, forced: false, toppedUpAtMs: null,
  }
}

function resyncState(overrides: Partial<MemberResyncState>): MemberResyncState {
  return {
    stateVersion: 1, anchorMemberKey: null, anchorJoinDate: null, referencePage: null, pageIdentity: null,
    cursorUpdatedAtMs: 0, cycleStartedAtMs: null, completedAtMs: null, inProgress: false,
    ...overrides,
  }
}

function harness(options: {
  feed: MemberFeedState | null
  resync: MemberResyncState | null
  nowMs: number
  intervalDays?: MemberResyncIntervalDays
}) {
  const started: MemberCollectionStartRequest[] = []
  const job = createMemberResyncJob({
    feed: () => ({ readMemberFeedState: async () => options.feed }) as unknown as MemberRepository,
    resync: () => ({ readResyncState: async () => options.resync }) as unknown as MemberResyncRepository,
    runner: {
      start: (request) => {
        started.push(request)
        return { kind: 'started' }
      },
      stop: () => undefined,
      isRunning: () => false,
      isStopping: () => false,
    },
    intervalDays: () => options.intervalDays ?? 30,
    now: () => options.nowMs,
  })
  return { job, started }
}

describe('member re-walk job', () => {
  it('stays out of the rotation until the first walk has finished', async () => {
    const { job } = harness({ feed: feedState(null), resync: null, nowMs: WALK_DONE + 400 * DAY })
    expect(await job.readProgress()).toEqual({ exists: false, complete: false, forced: false })
  })

  it('stays out of the rotation until the interval has run out', async () => {
    const { job } = harness({ feed: feedState(WALK_DONE), resync: null, nowMs: WALK_DONE + 20 * DAY })
    expect((await job.readProgress()).exists).toBe(false)
  })

  it('starts a fresh cycle from page 1 once due', async () => {
    const { job, started } = harness({ feed: feedState(WALK_DONE), resync: null, nowMs: WALK_DONE + 31 * DAY })
    expect((await job.readProgress()).exists).toBe(true)
    expect(job.start(120)).toEqual({ kind: 'started' })
    expect(started).toEqual([{ mode: 'resync', maxPages: 120, resumeFromCheckpoint: false }])
  })

  it('carries a cycle under way on, whatever the interval says', async () => {
    const inProgress = resyncState({ cycleStartedAtMs: WALK_DONE + 31 * DAY, referencePage: 400, inProgress: true })
    const { job, started } = harness({ feed: feedState(WALK_DONE), resync: inProgress, nowMs: WALK_DONE + 33 * DAY, intervalDays: 0 })
    expect((await job.readProgress()).exists).toBe(true)
    job.start(50)
    expect(started[0]).toEqual({ mode: 'resync', maxPages: 50, resumeFromCheckpoint: true })
  })

  it('waits the interval again after a cycle completes', async () => {
    const done = resyncState({ cycleStartedAtMs: WALK_DONE + 31 * DAY, completedAtMs: WALK_DONE + 40 * DAY })
    const early = harness({ feed: feedState(WALK_DONE), resync: done, nowMs: WALK_DONE + 60 * DAY })
    expect((await early.job.readProgress()).exists).toBe(false)
    const late = harness({ feed: feedState(WALK_DONE), resync: done, nowMs: WALK_DONE + 71 * DAY })
    expect((await late.job.readProgress()).exists).toBe(true)
  })

  it('has nothing to do without storage', async () => {
    const job = createMemberResyncJob({
      feed: () => null,
      resync: () => null,
      runner: { start: () => ({ kind: 'started' }), stop: () => undefined, isRunning: () => false, isStopping: () => false },
      intervalDays: () => 30,
      now: () => WALK_DONE,
    })
    expect(await job.readProgress()).toEqual({ exists: false, complete: false, forced: false })
  })
})
