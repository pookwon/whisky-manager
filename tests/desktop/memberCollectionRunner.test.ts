import { describe, expect, it, vi } from 'vitest'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'
import { createMemberCollectionRunner } from '../../src/desktop/memberCollectionRunner.js'
import type { MemberRepository, MemberFeedState } from '../../src/desktop/collection-db/memberRepository.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'

// Fake transport that is always connected
function fakeTransport(): ExtensionTransport {
  return {
    isConnected: () => true,
    send: vi.fn(),
    onMessage: vi.fn(),
  } as unknown as ExtensionTransport
}

// Fake member repository with an incomplete walk
function fakeMemberRepo(): MemberRepository {
  const state: MemberFeedState = {
    complete: false,
    forced: false,
    toppedUpAtMs: null,
  } as unknown as MemberFeedState
  return { readMemberFeedState: async () => state } as unknown as MemberRepository
}

describe('shared lock contention between article and member runners', () => {
  it('member start is refused ALREADY_RUNNING while article run is in flight', async () => {
    const lock = createCollectionLock()
    // The orchestrator run() won't be called in a unit test without the full chain,
    // so we test the lock directly by acquiring it as the article runner would.
    // Article runner acquires first.
    expect(lock.tryAcquire()).toBe(true)
    expect(lock.isHeld()).toBe(true)

    // Member runner tries to start while the lock is held — must be refused.
    const transport = fakeTransport()
    const memberRunner = createMemberCollectionRunner({
      repository: () => fakeMemberRepo(),
      transport,
      clock: { now: () => Date.now() },
      random: { intInclusive: () => 0 },
      sleep: async () => {},
      isSessionBusy: () => false,
      lock,
      newId: () => 'id-1',
    })

    const result = memberRunner.start({ mode: 'incremental', maxPages: 10, resumeFromCheckpoint: true })
    expect(result).toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })
  })

  it('member start succeeds after the article run finishes and releases the lock', () => {
    const lock = createCollectionLock()

    // Simulate article runner holding then releasing.
    expect(lock.tryAcquire()).toBe(true)
    lock.release()

    const transport = fakeTransport()
    const memberRunner = createMemberCollectionRunner({
      repository: () => fakeMemberRepo(),
      transport,
      clock: { now: () => Date.now() },
      random: { intInclusive: () => 0 },
      sleep: async () => {},
      isSessionBusy: () => false,
      lock,
      newId: () => 'id-2',
    })

    // Now the lock is free; start should proceed (will fail internally since
    // the orchestrator needs a real DB, but the runner itself returns 'started').
    const result = memberRunner.start({ mode: 'incremental', maxPages: 10, resumeFromCheckpoint: true })
    // The runner acquired the lock and returned 'started'.
    expect(result).toEqual({ kind: 'started' })
    expect(lock.isHeld()).toBe(true) // still held while in flight
  })

  it('lock is released when the orchestrator promise rejects', async () => {
    const lock = createCollectionLock()
    const transport = fakeTransport()

    // Intercept the orchestrator creation by making the member runner start
    // and then having the underlying promise reject. We achieve this by giving
    // a member repository whose readMemberFeedState causes the orchestrator to
    // error during run().
    //
    // The simpler approach: use createCollectionRunner (article side) with a
    // mock orchestrator. For the member side we need a real orchestrator that
    // can reject — we mock its sleep to throw immediately.
    let called = false
    const memberRunner = createMemberCollectionRunner({
      repository: () => fakeMemberRepo(),
      transport,
      clock: { now: () => Date.now() },
      random: { intInclusive: () => 0 },
      sleep: async () => {
        if (!called) { called = true; throw new Error('simulated failure') }
      },
      isSessionBusy: () => false,
      lock,
      newId: () => 'id-3',
      onError: () => {}, // suppress error logging
    })

    const result = memberRunner.start({ mode: 'incremental', maxPages: 10, resumeFromCheckpoint: true })
    expect(result).toEqual({ kind: 'started' })
    expect(lock.isHeld()).toBe(true)

    // Wait for the promise to settle (the orchestrator will call sleep which throws).
    await new Promise((r) => setTimeout(r, 50))
    expect(lock.isHeld()).toBe(false)
  })
})
