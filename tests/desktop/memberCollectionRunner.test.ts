import { describe, expect, it, vi } from 'vitest'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'
import { createCollectionRunner } from '../../src/desktop/collectionRunner.js'
import { createMemberCollectionRunner } from '../../src/desktop/memberCollectionRunner.js'
import type { MemberRepository, MemberFeedState } from '../../src/desktop/collection-db/memberRepository.js'
import type { CollectionRepository, CollectionFeedState } from '../../src/desktop/collection-db/repository.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'

// Fake transport that is always connected
function fakeTransport(): ExtensionTransport {
  return {
    isConnected: () => true,
    send: vi.fn(),
    onMessage: vi.fn(),
  } as unknown as ExtensionTransport
}

const baseState: MemberFeedState = {
  stateVersion: 0,
  anchorMemberKey: null,
  anchorJoinDate: null,
  referencePage: null,
  pageIdentity: null,
  totalMemberCount: null,
  cursorUpdatedAtMs: 0,
  complete: false,
  forced: false,
  toppedUpAtMs: null,
}

// Minimal fake article repo — causes the article orchestrator to fail fast so
// the lock is released without reading any real pages.
function fullFakeArticleRepo(overrides: Partial<CollectionRepository> = {}): CollectionRepository {
  const state: CollectionFeedState = {
    stateVersion: 0,
    anchorPostId: null,
    targetStartMs: 0,
    targetEndMs: 1_000,
    referencePage: null,
    pageIdentity: null,
    anchorPostedAtMs: null,
    cursorUpdatedAtMs: 0,
    complete: false,
    forced: false,
  }
  return {
    readFeedState: async () => state,
    startRun: async () => { throw new Error('quick-exit') },
    recordPageRequest: async () => undefined,
    finishRun: async () => undefined,
    setForced: async () => undefined,
    reconcileOrphanedRuns: async () => 0,
    persistPage: async () => ({ kind: 'conflict' }),
    ...overrides,
  }
}

// Full fake repo with all methods needed by the orchestrator
function fullFakeRepo(overrides: Partial<MemberRepository> = {}): MemberRepository {
  return {
    readMemberFeedState: async () => baseState,
    startRun: async () => baseState,
    recordPageRequest: async () => undefined,
    finishRun: async () => undefined,
    persistPage: async () => ({ kind: 'conflict' }),
    markCompleted: async () => undefined,
    markToppedUp: async () => undefined,
    setForced: async () => undefined,
    reconcileOrphanedRuns: async () => 0,
    knownMemberKeys: async () => new Set<string>(),
    ...overrides,
  }
}

describe('shared lock contention between article and member runners', () => {
  it('two runners sharing a lock: second is refused while first is in flight', async () => {
    const lock = createCollectionLock()
    // runnerA (member runner) hangs in startRun until we release it, holding the lock.
    let releaseA!: () => void
    const hangA = new Promise<void>((r) => { releaseA = r })

    const runnerA = createMemberCollectionRunner({
      repository: () => fullFakeRepo({ startRun: async () => { await hangA; return baseState } }),
      transport: fakeTransport(),
      clock: { now: () => Date.now() },
      random: { intInclusive: () => 0 },
      sleep: async () => {},
      isSessionBusy: () => false,
      lock,
      newId: () => 'id-a',
    })
    // runnerB is an article runner — exercises the other half of the mutual exclusion.
    const runnerB = createCollectionRunner({
      repository: () => fullFakeArticleRepo(),
      transport: fakeTransport(),
      clock: { now: () => Date.now() },
      random: { intInclusive: () => 0 },
      sleep: async () => {},
      isSessionBusy: () => false,
      lock,
      newId: () => 'id-b',
      onError: () => {},
    })

    // A starts and hangs, holding the lock.
    expect(runnerA.start({ mode: 'incremental', maxPages: 10, resumeFromCheckpoint: true })).toEqual({ kind: 'started' })
    expect(lock.isHeld()).toBe(true)

    // B (article runner) is refused while A (member runner) is in flight.
    expect(runnerB.start({ range: { startMs: 0, endMs: 1_000 }, kind: 'backfill', maxPages: 10 })).toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })

    // Release A and let the orchestrator finish.
    releaseA()
    await new Promise((r) => setTimeout(r, 50))
    expect(lock.isHeld()).toBe(false)

    // B succeeds now that the lock is free.
    const secondStart = runnerB.start({ range: { startMs: 0, endMs: 1_000 }, kind: 'backfill', maxPages: 10 })
    expect(secondStart).toEqual({ kind: 'started' })
    await new Promise((r) => setTimeout(r, 50)) // let B's run finish
  })

  it('lock is released when the orchestrator run fails', async () => {
    const lock = createCollectionLock()

    // The repo's startRun succeeds; recordPageRequest throws to trigger the error path.
    const memberRunner = createMemberCollectionRunner({
      repository: () => fullFakeRepo({
        recordPageRequest: async () => { throw new Error('simulated failure') },
      }),
      transport: fakeTransport(),
      clock: { now: () => Date.now() },
      random: { intInclusive: () => 0 },
      sleep: async () => {},
      isSessionBusy: () => false,
      lock,
      newId: () => 'id-3',
      onError: () => {},
    })

    const result = memberRunner.start({ mode: 'incremental', maxPages: 10, resumeFromCheckpoint: true })
    expect(result).toEqual({ kind: 'started' })
    expect(lock.isHeld()).toBe(true)

    // Wait for the orchestrator to fail and release the lock.
    await new Promise((r) => setTimeout(r, 50))
    expect(lock.isHeld()).toBe(false)
  })
})
