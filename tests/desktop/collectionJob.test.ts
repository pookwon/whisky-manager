import { describe, expect, it } from 'vitest'
import { createMemberCollectionJob, createArticleCollectionJob } from '../../src/desktop/collectionJob.js'
import type { MemberRepository, MemberFeedState } from '../../src/desktop/collection-db/memberRepository.js'
import type { CollectionStartResult } from '../../src/desktop/collectionRunner.js'
import type { MemberCollectionRunner } from '../../src/desktop/memberCollectionRunner.js'
import type { CollectionRepository, CollectionFeed, CollectionFeedState } from '../../src/desktop/collection-db/repository.js'
import type { CollectionRunner } from '../../src/desktop/collectionRunner.js'

// Times that straddle UTC midnight but fall within the same KST day:
// 2026-09-02T14:30Z = 2026-09-02 23:30 KST
// 2026-09-02T14:50Z = 2026-09-02 23:50 KST
const TOPPED_UP_AT = Date.UTC(2026, 8, 2, 14, 30) // 23:30 KST same day
const NOW_SAME_DAY = Date.UTC(2026, 8, 2, 14, 50) // 23:50 KST same day
// 2026-09-02T15:10Z = 2026-09-03 00:10 KST — next KST day
const NOW_NEXT_DAY = Date.UTC(2026, 8, 2, 15, 10) // 00:10 KST next day

function fakeRepo(state: MemberFeedState | null): MemberRepository {
  return { readMemberFeedState: async () => state } as unknown as MemberRepository
}

function fakeMemberRunner(): { runner: MemberCollectionRunner; starts: { mode: string }[] } {
  const starts: { mode: string }[] = []
  const runner: MemberCollectionRunner = {
    start(req) { starts.push({ mode: req.mode }); return { kind: 'started' } },
    stop() {},
    isRunning() { return false },
  }
  return { runner, starts }
}

describe('createMemberCollectionJob', () => {
  it('startDailyMaintenance returns null when walk is not complete', async () => {
    const { runner, starts } = fakeMemberRunner()
    const job = createMemberCollectionJob({ repository: () => fakeRepo({ complete: false, toppedUpAtMs: null, forced: false } as MemberFeedState), runner })
    await job.readProgress()
    const result = await job.startDailyMaintenance!(100, NOW_SAME_DAY)
    expect(result).toBeNull()
    expect(starts).toHaveLength(0)
  })

  it('startDailyMaintenance starts topup when complete and toppedUpAtMs is null', async () => {
    const { runner, starts } = fakeMemberRunner()
    const job = createMemberCollectionJob({ repository: () => fakeRepo({ complete: true, toppedUpAtMs: null, forced: false } as MemberFeedState), runner })
    await job.readProgress()
    const result = await job.startDailyMaintenance!(100, NOW_SAME_DAY)
    expect(result).toEqual({ kind: 'started' })
    expect(starts).toHaveLength(1)
    expect(starts[0]!.mode).toBe('topup')
  })

  it('startDailyMaintenance is skipped when toppedUpAtMs is same KST day (UTC midnight straddle)', async () => {
    const { runner, starts } = fakeMemberRunner()
    const job = createMemberCollectionJob({ repository: () => fakeRepo({ complete: true, toppedUpAtMs: TOPPED_UP_AT, forced: false } as MemberFeedState), runner })
    await job.readProgress()
    const result = await job.startDailyMaintenance!(100, NOW_SAME_DAY)
    expect(result).toBeNull()
    expect(starts).toHaveLength(0)
  })

  it('startDailyMaintenance runs when toppedUpAtMs was 23:50 KST and now is 00:10 KST next day', async () => {
    const { runner, starts } = fakeMemberRunner()
    const job = createMemberCollectionJob({ repository: () => fakeRepo({ complete: true, toppedUpAtMs: TOPPED_UP_AT, forced: false } as MemberFeedState), runner })
    await job.readProgress()
    const result = await job.startDailyMaintenance!(100, NOW_NEXT_DAY)
    expect(result).toEqual({ kind: 'started' })
    expect(starts).toHaveLength(1)
    expect(starts[0]!.mode).toBe('topup')
  })
})

const feed: CollectionFeed = { feedKind: 'all_articles', menuId: '0' }

function makeState(overrides: Partial<CollectionFeedState> = {}): CollectionFeedState {
  return {
    stateVersion: 1,
    targetStartMs: Date.UTC(2026, 6, 1),
    targetEndMs: Date.UTC(2026, 7, 1),
    anchorPostId: '1',
    anchorPostedAtMs: Date.UTC(2026, 6, 20),
    complete: false,
    forced: false,
    cursorUpdatedAtMs: Date.UTC(2026, 7, 1),
    referencePage: 1,
    pageIdentity: 'fnv1a64:0000000000000001',
    ...overrides,
  }
}

function fakeArticleRunner(result: CollectionStartResult = { kind: 'started' }): CollectionRunner {
  return { start: () => result, stop() {}, isRunning() { return false } }
}

function fakeArticleRepo(state: CollectionFeedState | null): CollectionRepository {
  return { readFeedState: async () => state } as unknown as CollectionRepository
}

describe('createArticleCollectionJob readProgress', () => {
  it('exists=false and complete/forced=false when repo returns null', async () => {
    const job = createArticleCollectionJob({ repository: () => fakeArticleRepo(null), runner: fakeArticleRunner(), feed })
    const p = await job.readProgress()
    expect(p).toEqual({ exists: false, complete: false, forced: false })
  })

  it('exists=true complete=false forced=false for an unfinished job', async () => {
    const job = createArticleCollectionJob({ repository: () => fakeArticleRepo(makeState()), runner: fakeArticleRunner(), feed })
    const p = await job.readProgress()
    expect(p).toEqual({ exists: true, complete: false, forced: false })
  })

  it('exists=true complete=true for a finished job', async () => {
    const job = createArticleCollectionJob({ repository: () => fakeArticleRepo(makeState({ complete: true })), runner: fakeArticleRunner(), feed })
    const p = await job.readProgress()
    expect(p).toMatchObject({ exists: true, complete: true })
  })

  it('exists=true forced=true when forced', async () => {
    const job = createArticleCollectionJob({ repository: () => fakeArticleRepo(makeState({ forced: true })), runner: fakeArticleRunner(), feed })
    const p = await job.readProgress()
    expect(p).toMatchObject({ forced: true })
  })
})
