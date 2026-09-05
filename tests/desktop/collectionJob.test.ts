import { describe, expect, it } from 'vitest'
import { createMemberCollectionJob, createArticleCollectionJob } from '../../src/desktop/collectionJob.js'
import type { MemberRepository, MemberFeedState } from '../../src/desktop/collection-db/memberRepository.js'
import type { CollectionStartResult, CollectionStartRequest } from '../../src/desktop/collectionRunner.js'
import type { MemberCollectionRunner } from '../../src/desktop/memberCollectionRunner.js'
import type { CollectionRepository, CollectionFeedState, StoredFeedState } from '../../src/desktop/collection-db/repository.js'
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

function makeState(overrides: Partial<CollectionFeedState> = {}): StoredFeedState {
  return {
    feed: { feedKind: 'all_articles', menuId: '0' },
    queueOrder: null,
    boardName: null,
    stateVersion: 1,
    targetStartMs: Date.UTC(2026, 6, 1),
    targetEndMs: Date.UTC(2026, 7, 1),
    anchorPostId: '1',
    anchorPostedAtMs: Date.UTC(2026, 6, 20),
    complete: false,
    forced: false,
    horizonReached: false,
    cursorUpdatedAtMs: Date.UTC(2026, 7, 1),
    referencePage: 1,
    pageIdentity: 'fnv1a64:0000000000000001',
    ...overrides,
  }
}

function fakeArticleRunner(result: CollectionStartResult = { kind: 'started' }): CollectionRunner {
  return { start: () => result, stop() {}, isRunning() { return false } }
}

function fakeArticleRepo(state: StoredFeedState | null): CollectionRepository {
  return { listFeedStates: async () => (state === null ? [] : [state]) } as unknown as CollectionRepository
}

describe('createArticleCollectionJob readProgress', () => {
  it('exists=false and complete/forced=false when repo returns null', async () => {
    const job = createArticleCollectionJob({ repository: () => fakeArticleRepo(null), runner: fakeArticleRunner() })
    const p = await job.readProgress()
    expect(p).toEqual({ exists: false, complete: false, forced: false })
  })

  it('exists=true complete=false forced=false for an unfinished job', async () => {
    const job = createArticleCollectionJob({ repository: () => fakeArticleRepo(makeState()), runner: fakeArticleRunner() })
    const p = await job.readProgress()
    expect(p).toEqual({ exists: true, complete: false, forced: false })
  })

  it('exists=true complete=true for a finished job', async () => {
    const job = createArticleCollectionJob({ repository: () => fakeArticleRepo(makeState({ complete: true })), runner: fakeArticleRunner() })
    const p = await job.readProgress()
    expect(p).toMatchObject({ exists: true, complete: true })
  })

  it('exists=true forced=true when forced', async () => {
    const job = createArticleCollectionJob({ repository: () => fakeArticleRepo(makeState({ forced: true })), runner: fakeArticleRunner() })
    const p = await job.readProgress()
    expect(p).toMatchObject({ forced: true })
  })
})

function fakeCollectionRepo(rows: StoredFeedState[]): CollectionRepository {
  return { listFeedStates: async () => rows } as unknown as CollectionRepository
}
function fakeRunner(): { runner: CollectionRunner; starts: CollectionStartRequest[] } {
  const starts: CollectionStartRequest[] = []
  return { starts, runner: { start(req: CollectionStartRequest) { starts.push(req); return { kind: 'started' } }, stop() {}, isRunning() { return false } } }
}
function board(menuId: string, queueOrder: number, over: Partial<StoredFeedState> = {}): StoredFeedState {
  return { feed: { feedKind: 'board', menuId }, queueOrder, boardName: `board ${menuId}`, stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null, cursorUpdatedAtMs: 0, targetStartMs: 100, targetEndMs: 200, complete: false, forced: false, horizonReached: false, ...over }
}

describe('createArticleCollectionJob over a board job', () => {
  it('reports the job from its rows and starts what remains, in order', async () => {
    const { runner, starts } = fakeRunner()
    const job = createArticleCollectionJob({ repository: () => fakeCollectionRepo([board('205', 3), board('137', 1, { complete: true }), board('189', 2)]), runner })
    expect(await job.readProgress()).toEqual({ exists: true, complete: false, forced: false })
    job.start(50)
    expect(starts[0]).toMatchObject({ range: { startMs: 100, endMs: 200 }, maxPages: 50, resumeFromCheckpoint: true, feeds: [{ feedKind: 'board', menuId: '189' }, { feedKind: 'board', menuId: '205' }] })
  })

  it('has nothing to start when no row exists', async () => {
    const { runner, starts } = fakeRunner()
    const job = createArticleCollectionJob({ repository: () => fakeCollectionRepo([]), runner })
    expect(await job.readProgress()).toEqual({ exists: false, complete: false, forced: false })
    expect(job.start(50)).toEqual({ kind: 'refused', reason: 'NO_JOB' })
    expect(starts).toHaveLength(0)
  })
})
