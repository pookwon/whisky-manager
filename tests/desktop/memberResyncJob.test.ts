import { describe, expect, it } from 'vitest'
import { createMemberResyncJob } from '../../src/desktop/memberResyncJob.js'
import type { MemberFeedState, MemberRepository } from '../../src/desktop/collection-db/memberRepository.js'
import type { MemberResyncRepository, MemberResyncState } from '../../src/desktop/collection-db/memberResyncRepository.js'
import type { MemberCollectionStartRequest } from '../../src/desktop/memberCollectionRunner.js'

const DAY = 86_400_000
/** 2026-09-15 12:00 KST. */
const WALK_DONE = Date.UTC(2026, 8, 15, 3)
/** 2026-10-01 10:00 KST, and the same month's fourth day. */
const OCT_1 = Date.UTC(2026, 9, 1, 1)
const OCT_4 = OCT_1 + 3 * DAY

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
  enabled?: boolean
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
    enabled: () => options.enabled ?? true,
    now: () => options.nowMs,
  })
  return { job, started }
}

describe('member re-walk job', () => {
  it('stays out of the rotation until the first walk has finished', async () => {
    const { job } = harness({ feed: feedState(null), resync: null, nowMs: OCT_1 })
    expect(await job.readProgress()).toEqual({ exists: false, complete: false, forced: false })
  })

  it('stays out of the rotation after the first days of the month', async () => {
    const { job } = harness({ feed: feedState(WALK_DONE), resync: null, nowMs: OCT_4 })
    expect((await job.readProgress()).exists).toBe(false)
  })

  it('starts a fresh cycle from page 1 on the first days of a month', async () => {
    const { job, started } = harness({ feed: feedState(WALK_DONE), resync: null, nowMs: OCT_1 })
    expect((await job.readProgress()).exists).toBe(true)
    expect(job.start(120)).toEqual({ kind: 'started' })
    expect(started).toEqual([{ mode: 'resync', maxPages: 120, resumeFromCheckpoint: false }])
  })

  it('carries a cycle under way on, whatever the date or the switch says', async () => {
    const inProgress = resyncState({ cycleStartedAtMs: OCT_1, referencePage: 400, inProgress: true })
    const { job, started } = harness({ feed: feedState(WALK_DONE), resync: inProgress, nowMs: OCT_4 + 10 * DAY, enabled: false })
    expect((await job.readProgress()).exists).toBe(true)
    job.start(50)
    expect(started[0]).toEqual({ mode: 'resync', maxPages: 50, resumeFromCheckpoint: true })
  })

  it('does not start again once a cycle has completed within the week', async () => {
    const done = resyncState({ cycleStartedAtMs: OCT_1, completedAtMs: OCT_1 + 2 * 3_600_000 })
    const { job } = harness({ feed: feedState(WALK_DONE), resync: done, nowMs: OCT_1 + DAY })
    expect((await job.readProgress()).exists).toBe(false)
  })

  it('stays off when the automatic re-walk is switched off', async () => {
    const { job } = harness({ feed: feedState(WALK_DONE), resync: null, nowMs: OCT_1, enabled: false })
    expect((await job.readProgress()).exists).toBe(false)
  })

  it('has nothing to do without storage', async () => {
    const job = createMemberResyncJob({
      feed: () => null,
      resync: () => null,
      runner: { start: () => ({ kind: 'started' }), stop: () => undefined, isRunning: () => false, isStopping: () => false },
      enabled: () => true,
      now: () => WALK_DONE,
    })
    expect(await job.readProgress()).toEqual({ exists: false, complete: false, forced: false })
  })
})
