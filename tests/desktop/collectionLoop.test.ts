import { describe, expect, it } from 'vitest'
import { createCollectionLoop } from '../../src/desktop/collectionLoop.js'
import {
  DEFAULT_COLLECTION_SCHEDULE,
  type CollectionSchedule,
} from '../../src/shared/collectionSchedule.js'
import type { CollectionStartRequest, CollectionStartResult } from '../../src/desktop/collectionRunner.js'
import type {
  CollectionFeed,
  CollectionFeedState,
  CollectionRepository,
} from '../../src/desktop/collection-db/repository.js'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
/** 2026-08-31 08:00 KST, an hour before the 09:00 window opens. */
const NOW = Date.UTC(2026, 7, 30, 23)
const kst = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 16).replace('T', ' ')

const feed: CollectionFeed = { feedKind: 'all_articles', menuId: '0' }

function job(overrides: Partial<CollectionFeedState> = {}): CollectionFeedState {
  return {
    stateVersion: 1,
    targetStartMs: Date.UTC(2026, 6, 1),
    targetEndMs: Date.UTC(2026, 7, 1),
    anchorPostId: '900000',
    anchorPostedAtMs: Date.UTC(2026, 6, 20),
    complete: false,
    cursorUpdatedAtMs: NOW - 2 * HOUR,
    referencePage: 120,
    pageIdentity: 'fnv1a64:0000000000000001',
    ...overrides,
  }
}

/**
 * Drives the loop with a clock the test moves, rather than popping timers by
 * hand: a beat that lays its successor at the current instant is a busy loop,
 * and only a harness that keeps firing whatever is due will notice.
 */
function harness(
  schedule: CollectionSchedule,
  feedState: CollectionFeedState | null,
  startResult: CollectionStartResult = { kind: 'started' },
) {
  const started: CollectionStartRequest[] = []
  const cleared: number[] = []
  let pending: { fn: () => void; dueAt: number; handle: number } | null = null
  let now = NOW
  let current = schedule
  let handles = 0

  const repository = {
    readFeedState: () => Promise.resolve(feedState),
  } as unknown as CollectionRepository

  const loop = createCollectionLoop({
    schedule: () => current,
    runner: {
      start: (request) => {
        started.push(request)
        return startResult
      },
      stop: () => undefined,
      isRunning: () => false,
    },
    repository: () => repository,
    feed,
    clock: { now: () => now },
    setTimer: (fn, ms) => {
      handles += 1
      pending = { fn, dueAt: now + ms, handle: handles }
      return handles
    },
    clearTimer: (handle) => {
      cleared.push(handle)
      if (pending?.handle === handle) pending = null
    },
  })

  return {
    loop,
    started,
    cleared,
    pendingDelayMs: () => (pending === null ? null : pending.dueAt - now),
    /** Advances the clock, firing every beat that falls due along the way. */
    advance: async (ms: number, fireLimit = 200): Promise<number> => {
      const target = now + ms
      let fired = 0
      while (pending !== null && pending.dueAt <= target) {
        if ((fired += 1) > fireLimit) throw new Error('loop fired too many times — busy loop')
        const due = pending
        now = Math.max(now, due.dueAt)
        pending = null
        due.fn()
        // The beat reads the database before starting, so its continuation runs
        // on a later microtask than the call itself.
        await Promise.resolve()
        await Promise.resolve()
      }
      now = target
      return fired
    },
    setSchedule: (next: CollectionSchedule) => {
      current = next
    },
  }
}

const enabled: CollectionSchedule = { ...DEFAULT_COLLECTION_SCHEDULE, enabled: true }

describe('collection loop', () => {
  it('waits for the active window to open', () => {
    const h = harness(enabled, job())
    h.loop.refresh()

    expect(h.pendingDelayMs()).toBe(1 * HOUR)
    expect(kst(h.loop.nextRunAt() ?? 0)).toBe('2026-08-31 09:00')
  })

  it('lays nothing while switched off', () => {
    const h = harness({ ...enabled, enabled: false }, job())
    h.loop.refresh()

    expect(h.pendingDelayMs()).toBeNull()
    expect(h.loop.nextRunAt()).toBeNull()
  })

  it('rests between blocks instead of beating continuously', async () => {
    // The failure this guards: laying the next beat at the current instant
    // while the window is open fires it again immediately, forever.
    const h = harness(enabled, job())
    h.loop.refresh()
    const fired = await h.advance(12 * HOUR)

    // 09:00-21:00 with two hours of work and two of rest leaves room for three.
    expect(fired).toBe(3)
    expect(h.started).toHaveLength(3)
  })

  it('continues the stored job rather than a window of its own', async () => {
    const state = job()
    const h = harness(enabled, state)
    h.loop.refresh()
    await h.advance(2 * HOUR)

    expect(h.started[0]).toMatchObject({
      resumeFromCheckpoint: true,
      range: { startMs: state.targetStartMs, endMs: state.targetEndMs },
    })
  })

  it('spends the work block as its page budget', async () => {
    const h = harness({ ...enabled, workBlockMinutes: 120 }, job())
    h.loop.refresh()
    await h.advance(2 * HOUR)

    // Derived from the pacing rule rather than stored, and near what two hours
    // of 5-9s requests with the periodic rests actually fits.
    expect(h.started[0]?.maxPages).toBeGreaterThan(250)
    expect(h.started[0]?.maxPages).toBeLessThan(320)
  })

  it('makes no request at all when there is no job', async () => {
    const h = harness(enabled, null)
    h.loop.refresh()
    const fired = await h.advance(12 * HOUR)

    expect(fired).toBeGreaterThan(0)
    expect(h.started).toHaveLength(0)
  })

  it('leaves a finished job alone instead of re-walking it every rest', async () => {
    // The failure this guards is quiet and endless: a job whose period has been
    // walked to its end still has a row, and a beat that only checks for the
    // row starts a run every rest period for as long as the app runs. Each one
    // spends a handful of requests on the cafe searching for a place to resume
    // and stores nothing.
    const h = harness(enabled, job({ complete: true }))
    h.loop.refresh()
    const fired = await h.advance(24 * HOUR)

    expect(fired).toBeGreaterThan(0)
    expect(h.started).toHaveLength(0)
  })

  it('waits one rest before looking again when nothing was started', async () => {
    const h = harness(enabled, null)
    h.loop.refresh()
    await h.advance(1 * HOUR)

    expect(h.pendingDelayMs()).toBe(enabled.restMinutes * MINUTE)
  })

  it('keeps beating after a refused start', async () => {
    // A browser that was closed is no reason to stop collecting at the next block.
    const h = harness(enabled, job(), { kind: 'refused', reason: 'BRIDGE_OFFLINE' })
    h.loop.refresh()
    await h.advance(12 * HOUR)

    expect(h.started.length).toBeGreaterThan(1)
  })

  it('does not run a beat the operator switched off while it was pending', async () => {
    const h = harness(enabled, job())
    h.loop.refresh()
    h.setSchedule({ ...enabled, enabled: false })
    await h.advance(2 * HOUR)

    expect(h.started).toHaveLength(0)
    expect(h.loop.nextRunAt()).toBeNull()
  })

  it('carries the rhythm into the next day rather than working through the night', async () => {
    const h = harness(enabled, job())
    h.loop.refresh()
    // Far enough to see tomorrow's blocks: 08:00 today to 20:00 tomorrow.
    await h.advance(DAY + 12 * HOUR)

    // Three blocks a day — 09:00, 13:00, 17:00 — and none through the night.
    expect(h.started).toHaveLength(6)
  })

  it('replaces the pending beat when the schedule is saved again', () => {
    const h = harness(enabled, job())
    h.loop.refresh()
    h.setSchedule({ ...enabled, activeWindowStartHourKst: 10 })
    h.loop.refresh()

    expect(h.cleared).toHaveLength(1)
    expect(kst(h.loop.nextRunAt() ?? 0)).toBe('2026-08-31 10:00')
  })

  it('leaves nothing pending after stop', () => {
    const h = harness(enabled, job())
    h.loop.refresh()
    h.loop.stop()

    expect(h.pendingDelayMs()).toBeNull()
    expect(h.loop.nextRunAt()).toBeNull()
  })
})
